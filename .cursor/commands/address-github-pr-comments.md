# Address GitHub PR Comments

Review and address comments on the current branch's pull request.

## Steps

1. **Get PR info and comments**:
   - `gh pr view --json number,title,url` - get PR number and URL
   - Use a single GraphQL query to fetch all reviews, review threads, and comments:
     ```bash
     gh api graphql -f query='
       query($owner: String!, $repo: String!, $pr: Int!) {
         repository(owner: $owner, name: $repo) {
           pullRequest(number: $pr) {
             reviews(first: 50) { nodes { author { login } state body } }
             reviewThreads(first: 100) {
               nodes {
                 isResolved
                 comments(first: 10) { nodes { author { login } body path line } }
               }
             }
             comments(first: 100) { nodes { author { login } body } }
           }
         }
       }' -f owner={owner} -f repo={repo} -F pr={number}
     ```

2. **Analyze comments**:
   - Categorize by type:
     - **Blocking**: Changes requested, must fix
     - **Suggestions**: Nice to have, consider fixing
     - **Questions**: Need to respond or clarify
     - **Resolved**: Already addressed
   - Identify which files/lines each comment refers to

3. **Present a summary**:

   ```
   ## PR Comments Summary

   ### Blocking (must address)
   - [ ] @reviewer: "issue description" (file.ts:42)

   ### Suggestions
   - [ ] @reviewer: "suggestion" (file.ts:100)

   ### Questions (need response)
   - [ ] @reviewer: "question?"
   ```

4. **Address each comment**:
   - For code changes: make the fix and explain what was done
   - For questions: suggest a reply the user can post
   - For suggestions: ask if user wants to implement or skip

5. **After fixes are made**:
   - Run format, lint, and tests if appropriate for the changed files
   - Summarize what was changed
   - Suggest a comment to post on the PR (e.g., "Addressed feedback - please re-review")

## Guidelines

- Read the actual code context around each comment
- Don't make changes without understanding the reviewer's intent
- If a comment is unclear, suggest asking for clarification
- Group related comments that can be fixed together
- Preserve the reviewer's intent - don't just make the linter happy

## Useful gh commands

```bash
# Get PR number for current branch
gh pr view --json number -q .number

# Get all review comments with file/line info
gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq '.[] | {author: .user.login, body: .body, path: .path, line: .line}'

# Get review threads (comments + replies)
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 10) {
              nodes {
                body
                author { login }
                path
                line
              }
            }
          }
        }
      }
    }
  }
' -f owner=OWNER -f repo=REPO -F pr=PR_NUMBER
```
