-- Repos
create table if not exists repos (
  id bigserial primary key,
  owner text not null,
  name text not null,
  default_branch text,
  unique(owner, name)
);

-- Commits
create table if not exists commits (
  sha text primary key,
  repo_owner text not null,
  repo_name text not null,
  author_login text,
  author_name text,
  committed_at timestamptz not null,
  additions int not null default 0,
  deletions int not null default 0,
  files_changed int not null default 0,
  message text,
  ai_assisted boolean,
  ai_confidence numeric,
  ai_reason text
);

create index if not exists idx_commits_repo_time on commits(repo_owner, repo_name, committed_at);
create index if not exists idx_commits_author_time on commits(author_login, committed_at);

-- Pull requests
create table if not exists pull_requests (
  id bigint primary key,
  repo_owner text not null,
  repo_name text not null,
  number int not null,
  author_login text,
  title text,
  created_at timestamptz not null,
  merged_at timestamptz,
  closed_at timestamptz,
  state text,
  additions int default 0,
  deletions int default 0,
  changed_files int default 0,
  unique(repo_owner, repo_name, number)
);

create index if not exists idx_pr_repo_created on pull_requests(repo_owner, repo_name, created_at);

-- Reviews (includes approval/comment/request_changes)
create table if not exists pr_reviews (
  id bigint primary key,
  repo_owner text not null,
  repo_name text not null,
  pr_number int not null,
  reviewer_login text,
  state text,
  submitted_at timestamptz,
  body text
);

create index if not exists idx_reviews_pr on pr_reviews(repo_owner, repo_name, pr_number);

-- Review comments
create table if not exists pr_review_comments (
  id bigint primary key,
  repo_owner text not null,
  repo_name text not null,
  pr_number int not null,
  commenter_login text,
  created_at timestamptz,
  body text
);

-- Issues (bug density via labels)
create table if not exists issues (
  id bigint primary key,
  repo_owner text not null,
  repo_name text not null,
  number int not null,
  author_login text,
  title text,
  created_at timestamptz not null,
  closed_at timestamptz,
  state text,
  is_bug boolean default false,
  unique(repo_owner, repo_name, number)
);

-- Deployments (use workflow runs as proxy if needed)
create table if not exists deployments (
  id bigserial primary key,
  repo_owner text not null,
  repo_name text not null,
  deployed_at timestamptz not null,
  environment text,
  status text,
  source text
);

create index if not exists idx_deploy_repo_time on deployments(repo_owner, repo_name, deployed_at);

-- Manual annotations (events like "AI tool rollout")
create table if not exists annotations (
  id bigserial primary key,
  repo_owner text,
  repo_name text,
  event_at timestamptz not null,
  label text not null,
  note text
);
