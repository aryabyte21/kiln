# Update Pull Request

Update the PR title and description for the current branch based on the actual changes.

## Steps

1. **Get PR and base branch**:
   - `gh pr view --json number,title,body,baseRefName` - get PR details
   - If no PR exists, inform user and suggest `/create-pr`
   - Extract `baseRefName` as the base branch (e.g., `main`, `develop`)

2. **Gather context** (run in parallel, using base branch from step 1):
   - `git log origin/{baseRefName}..HEAD --oneline` - commits on this branch
   - `git diff origin/{baseRefName}...HEAD --stat` - change summary

3. **Analyze changes**:
   - Review the diff: `git diff origin/{baseRefName}...HEAD`
   - Understand what changed and why

4. **Generate PR content**:

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

5. **Update the PR**:
   ```bash
   gh pr edit --title "<title>" --body "$(cat <<'EOF'
   <description>
   EOF
   )"
   ```

## Guidelines

- Be concise - communicate essentials only
- Read the actual diff, don't guess
- Highlight risks and areas needing attention
- Use bullet points for scannable summaries
