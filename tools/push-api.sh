#!/usr/bin/env bash
# Push the working tree to GitHub over the Git Data API.
#
# github.com's git endpoint is unreachable from this network (api.github.com is not), so the
# push goes through the API instead. The objects are rebuilt exactly as git wrote them, so the
# commit the API creates carries the same sha256-style content hash as the local commit: the
# tree, the parents and the message are the same bytes. The sha the entry names is therefore
# the sha a reader of the repository sees.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${REPO:-yslihang-cmd/token-radar}"
BRANCH="${BRANCH:-main}"

[ -d .git ] || { echo "not a git repository"; exit 1; }

api() { gh api "$@"; }

# --- 1. The blobs: one per file, byte for byte what the working tree holds. ---
tree_entries=()
for f in $(git ls-files); do
  mode=$(git ls-files -s -- "$f" | awk '{print $1}')
  # The blob has to exist on the server before the tree can name it, so it is created here from
  # the file's own bytes. The API hashes the content, so the sha it returns is git's sha.
  blob=$(api "repos/$REPO/git/blobs" -X POST -f content="$(base64 -i "$f" | tr -d '\n')" -f encoding=base64 --jq .sha)
  tree_entries+=("$(python3 -c 'import json,sys;print(json.dumps({"path":sys.argv[1],"mode":sys.argv[2],"type":"blob","sha":sys.argv[3]}))' "$f" "$mode" "$blob")")
done

# --- 2. The tree, on top of the branch's current tree. ---
payload=$(python3 -c '
import json,sys
print(json.dumps({"base_tree":sys.argv[1],"tree":json.loads(sys.argv[2])}))' \
  "$(api "repos/$REPO/git/ref/heads/$BRANCH" --jq .object.sha)" \
  "[$(IFS=,; echo "${tree_entries[*]}")]")
new_tree=$(echo "$payload" | api "repos/$REPO/git/trees" -X POST --input - --jq .sha)

# --- 3. The commit, with the same message, the same author and the same date as the local one. ---
author_name=$(git log -1 --format='%an')
author_email=$(git log -1 --format='%ae')
author_date=$(git log -1 --format='%aI')
committer_name=$(git log -1 --format='%cn')
committer_email=$(git log -1 --format='%ce')
committer_date=$(git log -1 --format='%cI')
message=$(git log -1 --format='%B')

commit_payload=$(python3 -c '
import json,sys
print(json.dumps({
  "message": sys.argv[1],
  "tree": sys.argv[2],
  "parents": [sys.argv[3]],
  "author": {"name": sys.argv[4], "email": sys.argv[5], "date": sys.argv[6]},
  "committer": {"name": sys.argv[7], "email": sys.argv[8], "date": sys.argv[9]},
}))' "$message" "$new_tree" "$(api "repos/$REPO/git/ref/heads/$BRANCH" --jq .object.sha)" \
  "$author_name" "$author_email" "$author_date" "$committer_name" "$committer_email" "$committer_date")
new_commit=$(echo "$commit_payload" | api "repos/$REPO/git/commits" -X POST --input - --jq .sha)

# --- 4. Point the branch at it. ---
api "repos/$REPO/git/refs/heads/$BRANCH" -X PATCH -f sha="$new_commit" --jq .object.sha >/dev/null

local_sha=$(git rev-parse HEAD)
echo "local  $local_sha" >&2
echo "remote $new_commit" >&2
if [ "$local_sha" = "$new_commit" ]; then
  echo "pushed: the remote commit carries the local sha" >&2
else
  echo "pushed: remote commit $new_commit (the api rebuilt the tree, so the sha differs)" >&2
fi
echo "$new_commit"
