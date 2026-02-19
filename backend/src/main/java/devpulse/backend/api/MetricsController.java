package devpulse.backend.api;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class MetricsController {

  private final JdbcTemplate jdbc;

  public MetricsController(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  // quick sanity check
  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("ok", true);
  }

  @GetMapping("/repos")
  public List<Map<String, Object>> repos() {
    return jdbc.queryForList("select owner, name, default_branch from repos order by owner, name");
  }

  // -----------------------------
  // KPI OVERVIEW (Option A)
  // -----------------------------
  @GetMapping("/metrics/overview")
  public Map<String, Object> overview(@RequestParam String owner, @RequestParam String repo,
                                      @RequestParam(required=false, defaultValue="30") int days) {
    // days is used across the KPIs so you can pick 30/90/180 in UI
    // NOTE: ai_assisted can be null; COALESCE handles it.
    String sql = """
      with window as (
        select now() - (? || ' days')::interval as start_ts
      ),
      pr_cycle as (
        select avg(extract(epoch from (coalesce(merged_at, closed_at) - created_at))/3600.0) as avg_pr_cycle_hours,
               count(*) as pr_count
        from pull_requests, window
        where repo_owner = ? and repo_name = ?
          and created_at >= window.start_ts
      ),
      first_review as (
        with first_review_per_pr as (
          select repo_owner, repo_name, pr_number, min(submitted_at) as first_review_at
          from pr_reviews, window
          where repo_owner=? and repo_name=?
            and submitted_at is not null
            and submitted_at >= window.start_ts
          group by repo_owner, repo_name, pr_number
        )
        select avg(extract(epoch from (fr.first_review_at - pr.created_at))/3600.0) as avg_first_review_hours
        from pull_requests pr
        join first_review_per_pr fr
          on fr.repo_owner=pr.repo_owner and fr.repo_name=pr.repo_name and fr.pr_number=pr.number
        where pr.repo_owner=? and pr.repo_name=?
          and pr.created_at >= (select start_ts from window)
      ),
      ai as (
        select
          count(*) as total_commits,
          sum(case when coalesce(ai_assisted,false) then 1 else 0 end) as ai_commits,
          (sum(case when coalesce(ai_assisted,false) then 1 else 0 end)::float / nullif(count(*),0)) as ai_ratio
        from commits, window
        where repo_owner=? and repo_name=?
          and committed_at >= window.start_ts
      ),
      bug as (
        with weekly as (
          select date_trunc('week', committed_at) as week, count(*) as commits
          from commits, window
          where repo_owner=? and repo_name=?
            and committed_at >= window.start_ts
          group by 1
        ),
        bugs as (
          select date_trunc('week', created_at) as week, count(*) as bug_issues
          from issues, window
          where repo_owner=? and repo_name=? and is_bug=true
            and created_at >= window.start_ts
          group by 1
        )
        select
          avg((coalesce(b.bug_issues,0)::float / nullif(w.commits,0)) * 100.0) as avg_bugs_per_100_commits
        from weekly w left join bugs b on b.week=w.week
      ),
      dep as (
        select count(*) as deployments
        from deployments, window
        where repo_owner=? and repo_name=?
          and deployed_at >= window.start_ts
      )
      select
        ? as days,
        (select avg_pr_cycle_hours from pr_cycle) as avg_pr_cycle_hours,
        (select pr_count from pr_cycle) as pr_count,
        (select avg_first_review_hours from first_review) as avg_first_review_hours,
        (select ai_ratio from ai) as ai_ratio,
        (select total_commits from ai) as total_commits,
        (select ai_commits from ai) as ai_commits,
        (select avg_bugs_per_100_commits from bug) as avg_bugs_per_100_commits,
        (select deployments from dep) as deployments,
        ((select deployments from dep) * 7.0 / nullif(?,0)) as deployments_per_week
    """;

    // days appears twice: in interval calc and deployments_per_week denominator; also returned for UI display
    List<Map<String, Object>> rows = jdbc.queryForList(
      sql,
      String.valueOf(days),
      owner, repo,
      owner, repo,
      owner, repo,
      owner, repo,
      owner, repo,
      owner, repo,
      owner, repo,
      owner, repo,
      owner, repo,
      days,
      days
    );

    return rows.isEmpty() ? Map.of() : rows.get(0);
  }

  // -----------------------------
  // Charts
  // -----------------------------
  @GetMapping("/metrics/pr-cycle")
  public List<Map<String, Object>> prCycle(@RequestParam String owner, @RequestParam String repo) {
    String sql = """
      select
        date_trunc('week', created_at) as week,
        avg(extract(epoch from (coalesce(merged_at, closed_at) - created_at))/3600.0) as avg_cycle_hours,
        count(*) as pr_count
      from pull_requests
      where repo_owner = ? and repo_name = ?
      group by 1
      order by 1
    """;
    return jdbc.queryForList(sql, owner, repo);
  }

  @GetMapping("/metrics/review-turnaround")
  public List<Map<String, Object>> reviewTurnaround(@RequestParam String owner, @RequestParam String repo) {
    String sql = """
      with first_review as (
        select
          pr_number,
          min(submitted_at) as first_review_at
        from pr_reviews
        where repo_owner=? and repo_name=?
          and submitted_at is not null
        group by pr_number
      )
      select
        date_trunc('week', pr.created_at) as week,
        avg(extract(epoch from (fr.first_review_at - pr.created_at))/3600.0) as avg_first_review_hours,
        count(*) as pr_count
      from pull_requests pr
      join first_review fr on fr.pr_number = pr.number
      where pr.repo_owner=? and pr.repo_name=?
      group by 1
      order by 1
    """;
    return jdbc.queryForList(sql, owner, repo, owner, repo);
  }

  @GetMapping("/metrics/ai-ratio")
  public List<Map<String, Object>> aiRatio(@RequestParam String owner, @RequestParam String repo) {
    String sql = """
      select
        date_trunc('week', committed_at) as week,
        count(*) as total_commits,
        sum(case when coalesce(ai_assisted,false) then 1 else 0 end) as ai_commits,
        (sum(case when coalesce(ai_assisted,false) then 1 else 0 end)::float / nullif(count(*),0)) as ai_ratio
      from commits
      where repo_owner = ? and repo_name = ?
      group by 1
      order by 1
    """;
    return jdbc.queryForList(sql, owner, repo);
  }

  @GetMapping("/metrics/bug-density")
  public List<Map<String, Object>> bugDensity(@RequestParam String owner, @RequestParam String repo) {
    String sql = """
      with weekly as (
        select date_trunc('week', committed_at) as week, count(*) as commits
        from commits
        where repo_owner=? and repo_name=?
        group by 1
      ),
      bugs as (
        select date_trunc('week', created_at) as week, count(*) as bug_issues
        from issues
        where repo_owner=? and repo_name=? and is_bug=true
        group by 1
      )
      select
        w.week,
        w.commits,
        coalesce(b.bug_issues,0) as bug_issues,
        (coalesce(b.bug_issues,0)::float / nullif(w.commits,0)) * 100.0 as bugs_per_100_commits
      from weekly w
      left join bugs b on b.week=w.week
      order by w.week
    """;
    return jdbc.queryForList(sql, owner, repo, owner, repo);
  }

  @GetMapping("/metrics/deployments")
  public List<Map<String, Object>> deployments(@RequestParam String owner, @RequestParam String repo) {
    String sql = """
      select
        date_trunc('week', deployed_at) as week,
        count(*) as deployments
      from deployments
      where repo_owner=? and repo_name=?
      group by 1
      order by 1
    """;
    return jdbc.queryForList(sql, owner, repo);
  }

  // -----------------------------
  // Heatmap (Option C)
  // commits per author per week
  // -----------------------------
  @GetMapping("/metrics/heatmap/commits")
  public List<Map<String, Object>> commitsHeatmap(@RequestParam String owner,
                                                  @RequestParam String repo,
                                                  @RequestParam(required=false, defaultValue="12") int weeks) {
    String sql = """
      with w as (
        select now() - (? || ' weeks')::interval as start_ts
      )
      select
        date_trunc('week', committed_at) as week,
        coalesce(author_login, author_name, 'unknown') as author,
        count(*) as commits
      from commits, w
      where repo_owner=? and repo_name=?
        and committed_at >= w.start_ts
      group by 1, 2
      order by 1, 2
    """;
    return jdbc.queryForList(sql, String.valueOf(weeks), owner, repo);
  }

  @GetMapping("/insights")
  public List<Map<String, Object>> insights(@RequestParam String owner, @RequestParam String repo) {
    String sql = """
      with ai as (
        select date_trunc('week', committed_at) as week,
               (sum(case when coalesce(ai_assisted,false) then 1 else 0 end)::float / nullif(count(*),0)) as ai_ratio
        from commits
        where repo_owner=? and repo_name=?
        group by 1
      ),
      bug as (
        select date_trunc('week', created_at) as week, count(*) as bug_issues
        from issues
        where repo_owner=? and repo_name=? and is_bug=true
        group by 1
      ),
      joined as (
        select a.week, a.ai_ratio, coalesce(b.bug_issues,0) as bug_issues
        from ai a left join bug b on b.week=a.week
      ),
      lagged as (
        select *,
          lag(ai_ratio) over (order by week) as prev_ai_ratio,
          lag(bug_issues) over (order by week) as prev_bug_issues
        from joined
      )
      select week,
             ai_ratio,
             bug_issues,
             case
               when prev_ai_ratio is not null and ai_ratio >= prev_ai_ratio * 1.2
                    and bug_issues <= coalesce(prev_bug_issues, bug_issues)
               then 'AI usage increased ~20% with bug volume stable → potential productivity gain signal'
               else null
             end as insight
      from lagged
      where insight is not null
      order by week
    """;
    return jdbc.queryForList(sql, owner, repo, owner, repo);
  }

  @GetMapping("/annotations")
  public List<Map<String, Object>> annotations(@RequestParam(required=false) String owner,
                                               @RequestParam(required=false) String repo) {
    if (owner == null && repo == null) {
      return jdbc.queryForList("select * from annotations order by event_at");
    }
    String sql = "select * from annotations where (repo_owner=? and repo_name=?) order by event_at";
    return jdbc.queryForList(sql, owner, repo);
  }

  @PostMapping("/annotations")
  public Map<String, Object> addAnnotation(@RequestBody Map<String, Object> body) {
    String owner = (String) body.get("owner");
    String repo = (String) body.get("repo");
    String eventAt = (String) body.get("eventAt");
    String label = (String) body.get("label");
    String note = (String) body.get("note");

    jdbc.update("""
      insert into annotations(repo_owner, repo_name, event_at, label, note)
      values (?,?,?,?,?)
    """, owner, repo, eventAt, label, note);

    return Map.of("ok", true);
  }
}
