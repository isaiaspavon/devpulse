import os
import time
import requests
import psycopg
from dateutil import parser as dt

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
OWNER = os.getenv("GITHUB_OWNER", "")
REPOS = [r.strip() for r in os.getenv("GITHUB_REPOS", "").split(",") if r.strip()]

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("POSTGRES_DB", "devpulse")
DB_USER = os.getenv("POSTGRES_USER", "devpulse")
DB_PASS = os.getenv("POSTGRES_PASSWORD", "devpulse")

HEADERS = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
}

def gh_get(url, params=None):
    while True:
        r = requests.get(url, headers=HEADERS, params=params)
        if r.status_code == 403 and "rate limit" in r.text.lower():
            time.sleep(10)
            continue
        r.raise_for_status()
        return r

def connect():
    return psycopg.connect(
        host=DB_HOST, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )

def upsert_repo(cur, owner, name, default_branch):
    cur.execute("""
      insert into repos(owner, name, default_branch)
      values (%s, %s, %s)
      on conflict(owner, name) do update set default_branch = excluded.default_branch
    """, (owner, name, default_branch))

def ingest_commits(cur, owner, repo, since_iso=None):
    # list commits
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    page = 1
    while True:
        params = {"per_page": 100, "page": page}
        if since_iso:
            params["since"] = since_iso
        data = gh_get(url, params=params).json()
        if not data:
            break

        for c in data:
            sha = c["sha"]
            commit_obj = c["commit"]
            message = commit_obj.get("message")
            committed_at = dt.parse(commit_obj["committer"]["date"])
            author_login = c["author"]["login"] if c.get("author") else None
            author_name = commit_obj["author"].get("name")

            # commit detail for stats
            detail = gh_get(f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}").json()
            stats = detail.get("stats", {}) or {}
            files = detail.get("files", []) or []

            additions = int(stats.get("additions") or 0)
            deletions = int(stats.get("deletions") or 0)
            files_changed = len(files)

            cur.execute("""
              insert into commits(sha, repo_owner, repo_name, author_login, author_name, committed_at,
                                  additions, deletions, files_changed, message)
              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              on conflict (sha) do update set
                author_login=excluded.author_login,
                author_name=excluded.author_name,
                committed_at=excluded.committed_at,
                additions=excluded.additions,
                deletions=excluded.deletions,
                files_changed=excluded.files_changed,
                message=excluded.message
            """, (sha, owner, repo, author_login, author_name, committed_at,
                  additions, deletions, files_changed, message))
        page += 1

def ingest_prs(cur, owner, repo, state="all"):
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    page = 1
    while True:
        params = {"per_page": 100, "page": page, "state": state}
        data = gh_get(url, params=params).json()
        if not data:
            break

        for pr in data:
            pr_number = pr["number"]
            pr_id = pr["id"]
            author_login = pr["user"]["login"] if pr.get("user") else None
            title = pr.get("title")
            created_at = dt.parse(pr["created_at"])
            merged_at = dt.parse(pr["merged_at"]) if pr.get("merged_at") else None
            closed_at = dt.parse(pr["closed_at"]) if pr.get("closed_at") else None
            pr_state = pr.get("state")

            # detail includes additions/deletions/changed_files
            detail = gh_get(f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}").json()
            additions = int(detail.get("additions") or 0)
            deletions = int(detail.get("deletions") or 0)
            changed_files = int(detail.get("changed_files") or 0)

            cur.execute("""
              insert into pull_requests(id, repo_owner, repo_name, number, author_login, title,
                                        created_at, merged_at, closed_at, state,
                                        additions, deletions, changed_files)
              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              on conflict (id) do update set
                author_login=excluded.author_login,
                title=excluded.title,
                created_at=excluded.created_at,
                merged_at=excluded.merged_at,
                closed_at=excluded.closed_at,
                state=excluded.state,
                additions=excluded.additions,
                deletions=excluded.deletions,
                changed_files=excluded.changed_files
            """, (pr_id, owner, repo, pr_number, author_login, title,
                  created_at, merged_at, closed_at, pr_state,
                  additions, deletions, changed_files))

            # reviews
            reviews = gh_get(f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/reviews",
                             params={"per_page": 100}).json()
            for rv in reviews:
                rv_id = rv["id"]
                reviewer = rv["user"]["login"] if rv.get("user") else None
                state = rv.get("state")
                submitted_at = dt.parse(rv["submitted_at"]) if rv.get("submitted_at") else None
                body = rv.get("body")

                cur.execute("""
                  insert into pr_reviews(id, repo_owner, repo_name, pr_number, reviewer_login, state, submitted_at, body)
                  values (%s,%s,%s,%s,%s,%s,%s,%s)
                  on conflict (id) do update set
                    reviewer_login=excluded.reviewer_login,
                    state=excluded.state,
                    submitted_at=excluded.submitted_at,
                    body=excluded.body
                """, (rv_id, owner, repo, pr_number, reviewer, state, submitted_at, body))

            # review comments
            comments = gh_get(f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/comments",
                              params={"per_page": 100}).json()
            for cm in comments:
                cm_id = cm["id"]
                commenter = cm["user"]["login"] if cm.get("user") else None
                created = dt.parse(cm["created_at"]) if cm.get("created_at") else None
                body = cm.get("body")

                cur.execute("""
                  insert into pr_review_comments(id, repo_owner, repo_name, pr_number, commenter_login, created_at, body)
                  values (%s,%s,%s,%s,%s,%s,%s)
                  on conflict (id) do update set
                    commenter_login=excluded.commenter_login,
                    created_at=excluded.created_at,
                    body=excluded.body
                """, (cm_id, owner, repo, pr_number, commenter, created, body))
        page += 1

def ingest_issues(cur, owner, repo):
    url = f"https://api.github.com/repos/{owner}/{repo}/issues"
    page = 1
    while True:
        params = {"per_page": 100, "page": page, "state": "all"}
        data = gh_get(url, params=params).json()
        if not data:
            break
        for iss in data:
            # GitHub "issues" includes PRs; skip PRs here
            if "pull_request" in iss:
                continue
            issue_id = iss["id"]
            number = iss["number"]
            author = iss["user"]["login"] if iss.get("user") else None
            title = iss.get("title")
            created_at = dt.parse(iss["created_at"])
            closed_at = dt.parse(iss["closed_at"]) if iss.get("closed_at") else None
            state = iss.get("state")
            labels = [l["name"].lower() for l in (iss.get("labels") or [])]
            is_bug = any("bug" in l for l in labels)

            cur.execute("""
              insert into issues(id, repo_owner, repo_name, number, author_login, title, created_at, closed_at, state, is_bug)
              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              on conflict (id) do update set
                title=excluded.title,
                created_at=excluded.created_at,
                closed_at=excluded.closed_at,
                state=excluded.state,
                is_bug=excluded.is_bug
            """, (issue_id, owner, repo, number, author, title, created_at, closed_at, state, is_bug))
        page += 1

def ingest_deployments_proxy(cur, owner, repo):
    # Quick proxy: use GitHub Actions workflow runs as "deployments" if you have CD workflows.
    url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs"
    page = 1
    while True:
        params = {"per_page": 50, "page": page}
        data = gh_get(url, params=params).json()
        runs = data.get("workflow_runs") or []
        if not runs:
            break

        for run in runs:
            # consider successful completed runs as "deployments"
            if run.get("status") != "completed":
                continue
            deployed_at = dt.parse(run["updated_at"])
            status = run.get("conclusion") or "unknown"
            name = (run.get("name") or "").lower()
            env = "prod" if "prod" in name or "deploy" in name else "unknown"

            cur.execute("""
              insert into deployments(repo_owner, repo_name, deployed_at, environment, status, source)
              values (%s,%s,%s,%s,%s,%s)
            """, (owner, repo, deployed_at, env, status, "github_actions"))
        page += 1

def main():
    if not (GITHUB_TOKEN and OWNER and REPOS):
        raise SystemExit("Missing env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPOS")

    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()

    for repo in REPOS:
        repo_meta = gh_get(f"https://api.github.com/repos/{OWNER}/{repo}").json()
        upsert_repo(cur, OWNER, repo, repo_meta.get("default_branch"))

        ingest_commits(cur, OWNER, repo, since_iso=None)
        ingest_prs(cur, OWNER, repo, state="all")
        ingest_issues(cur, OWNER, repo)
        ingest_deployments_proxy(cur, OWNER, repo)

        conn.commit()
        print(f"Done: {OWNER}/{repo}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
