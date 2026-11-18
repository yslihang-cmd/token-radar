#!/usr/bin/env bash
# Push the working tree to GitHub over the Contents API (github.com's git endpoint is unreachable
# from this network, api.github.com is not). One commit per run: every tracked file goes in a single
# tree, so the pushed commit matches the local one.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${REPO:-yslihang-cmd/token-radar}"
BRANCH="${BRANCH:-main}"
MSG="${1:-chore: sync}"

files=$(git ls-files)
[ -n "$files" ] || { echo "no tracked files"; exit 1; }

# Build the tree payload: one blob per file, keyed by its path.
tree=$(mktemp); blobs=$(mktemp)
trap 'rm -f "$tree" "$blobs"' EXIT
echo '[' > "$tree"
first=1
while IFS= read -r f; do
  mode=$(git ls-files -s -- "$f" | awk '{print $1}')
  [ "$mode" = "100755" ] && mode=100755 || mode=100644
  sha=$(gh api "repos/$REPO/git/blobs" -X POST -f content="$(base64 -i "$f" | tr -d '\n')" -f encoding=base64 --jq .sha)
  [ $first -eq 1 ] || echo ',' >> "$tree"
  first=0
  printf '  {"path": %s, "mode": "%s", "type": "blob", "sha": "%s"}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$f")" "$mode" "$sha" >> "$tree"
done <<< "$files"
echo ']' >> "$tree"

# The tree needs a base_tree so it keeps the files already on the branch.
base=$(gh api "repos/$REPO/git/ref/heads/$BRANCH" --jq .object.sha)
newtree=$(python3 -c 'import json,sys;print(json.dumps({"base_tree":sys.argv[1],"tree":json.load(open(sys.argv[2]))}))' "$base" "$tree" \
  | gh api "repos/$REPO/git/trees" -X POST --input - --jq .sha)

parent=$(gh api "repos/$REPO/git/ref/heads/$BRANCH" --jq .object.sha)
commit=$(python3 -c 'import json,sys;print(json.dumps({"message":sys.argv[1],"tree":sys.argv[2],"parents":[sys.argv[3]],"author":{"name":"LiHang","email":"ys_lihang@icloud.com"}}))' "$MSG" "$newtree" "$parent" \
  | gh api "repos/$REPO/git/commits" -X POST --input - --jq .sha)

gh api "repos/$REPO/git/refs/heads/$BRANCH" -X PATCH -f sha="$commit" --jq .object.sha >/dev/null
echo "pushed $commit to $BRANCH ($# files)" >&2
echo "$commit"
