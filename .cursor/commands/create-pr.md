# Create Pull Request

Create a new PR for the current branch with a well-crafted title and description.

**Base branch**: Defaults to `main`. User can specify a different base branch (e.g., `/create-pr against develop`).

## Steps

1. **Determine base branch**:
   - Default: `main`
   - If user specifies a branch (e.g., "against develop"), use that instead
   - Store as `BASE_BRANCH` for subsequent commands

2. **Gather context** (run in parallel):
   - `git branch --show-current` - get current branch
   - `git log origin/$BASE_BRANCH..HEAD --oneline` - commits on this branch
   - `git diff origin/$BASE_BRANCH...HEAD --stat` - change summary
   - `gh pr list --head $(git branch --show-current) --json number` - check if PR exists

3. **Check prerequisites**:
   - If PR already exists, suggest `/update-pr` instead
   - Ensure branch is pushed: `git push -u origin HEAD` (ask before pushing)

4. **Analyze changes**:
   - Review the diff: `git diff origin/$BASE_BRANCH...HEAD`
   - Understand what changed and why

5. **Generate PR content**:

   **Title format** (conventional commit):
   - `feat(<scope>): <description>` - new features
   - `fix(<scope>): <description>` - bug fixes
   - `refactor(<scope>): <description>` - restructuring
   - `chore(<scope>): <description>` - maintenance

   **Description template**:

   ```markdown
   ## Summary

   - [Key change 1]
   - [Key change 2]

   ## Notes for Reviewers

   [What to focus on, tradeoffs made, follow-up work]

   ## Testing & Confidence

   - **Risk Level**: [Low/Medium/High]
   - **Tested**: [What was tested]
   - **Known Gaps**: [What wasn't tested]
   ```

6. **Create the PR**:

   ```bash
   gh pr create --base $BASE_BRANCH --title "<title>" --body "$(cat <<'EOF'
   <description>
   EOF
   )"
   ```

7. **Return the PR URL**.

## Guidelines

- Be specific - read the actual diff, don't guess
- Highlight risks and areas needing review attention
- Use bullet points for scannable summaries
- If UI changes, note that screenshots should be added manually
- Always show the PR URL at the end

## Examples

```
/create-pr                     # Creates PR against main
/create-pr against develop     # Creates PR against develop branch
/create-pr base: staging       # Creates PR against staging branch
```
