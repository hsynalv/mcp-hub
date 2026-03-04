# AI-Hub Use Cases

AI-Hub'ın farklı senaryolardaki kullanım örnekleri ve workflow'ları.

## 1. Development Workflow Automation

### 1.1 Repository Analysis → Project Setup

**Senaryo:** Yeni bir repository analiz et ve proje yönetim sistemi kur.

```python
# Workflow: GitHub → Notion → Slack
def setup_project_from_github(repo_name):
    # 1. Repository analiz et
    analysis = ai_hub.analyze_repo(repo_name)
    
    # 2. Proje oluştur
    tasks = [
        {"gorev": f"Setup {analysis['repo']['language']} environment"},
        {"gorev": "Review code structure"},
        {"gorev": "Setup CI/CD pipeline"},
        {"gorev": "Configure monitoring"}
    ]
    
    project = ai_hub.create_notion_project(
        name=analysis['repo']['fullName'],
        status="Yapılıyor",
        tasks=tasks
    )
    
    # 3. Team bildirimi
    ai_hub.send_slack_message(
        "#projects",
        f"📁 New project created: {analysis['repo']['fullName']}\n{project['project']['url']}"
    )
    
    return project

# Kullanım
result = setup_project_from_github("vercel/next.js")
```

### 1.2 Code Review Automation

**Senaryo:** Pull request oluşturulduğunda otomatik analiz ve bildirim.

```javascript
// GitHub Webhook handler
app.post('/webhook/github', async (req, res) => {
    const { action, pull_request, repository } = req.body;
    
    if (action === 'opened' && pull_request) {
        // 1. PR detaylarını al
        pr_analysis = await ai_hub.github_analyze_pr(
            repository.full_name,
            pull_request.number
        );
        
        // 2. Code review yap
        review_result = await perform_code_review(pr_analysis);
        
        // 3. Slack bildirimi
        await ai_hub.send_slack_message(
            "#code-reviews",
            `🔍 PR Review: ${pull_request.title}\n` +
            `📊 Score: ${review_result.score}/10\n` +
            `👤 Reviewer: AI Assistant\n` +
            `${pr_analysis.url}`
        );
        
        // 4. Notion'a kaydet
        await ai_hub.create_notion_task(
            gorev=f"Review PR: {pull_request.title}",
            proje_id=project_mapping[repository.name]
        );
    }
    
    res.json({ status: 'processed' });
});
```

## 2. DevOps and Infrastructure Management

### 2.1 Container Orchestration

**Senaryo:** Docker container'larını otomatik yönet ve monitor et.

```python
class ContainerManager:
    def __init__(self):
        self.ai_hub = AIHubClient()
    
    def health_check_all_containers(self):
        """Tüm container'ların sağlık durumunu kontrol et"""
        containers = self.ai_hub.list_containers(all=True)
        
        health_report = {
            "total": len(containers['containers']),
            "running": 0,
            "stopped": 0,
            "unhealthy": []
        }
        
        for container in containers['containers']:
            if container['state'] == 'running':
                health_report['running'] += 1
                
                # Container log'larını kontrol et
                logs = self.ai_hub.get_container_logs(
                    container['id'], 
                    tail=10
                )
                
                if self.is_unhealthy(logs['logs']):
                    health_report['unhealthy'].append({
                        'id': container['id'],
                        'name': container['name'],
                        'issue': 'Error patterns in logs'
                    })
            else:
                health_report['stopped'] += 1
        
        return health_report
    
    def auto_restart_unhealthy(self):
        """Sağlıksız container'ları otomatik restart et"""
        health = self.health_check_all_containers()
        
        for unhealthy in health['unhealthy']:
            print(f"Restarting unhealthy container: {unhealthy['name']}")
            
            # Container'ı restart et
            result = self.ai_hub.restart_container(unhealthy['id'])
            
            if result['ok']:
                # Bildirim gönder
                self.ai_hub.send_slack_message(
                    "#alerts",
                    f"🔄 Container {unhealthy['name']} restarted automatically"
                )
    
    def is_unhealthy(self, logs):
        """Log'larda hata pattern'lerini ara"""
        error_patterns = ['ERROR', 'FATAL', 'Exception', 'failed']
        return any(pattern in log for log in logs for pattern in error_patterns)

# Scheduled task
manager = ContainerManager()
manager.auto_restart_unhealthy()
```

### 2.2 Deployment Pipeline

**Senaryo:** Deployment pipeline'ını AI-Hub ile entegre et.

```yaml
# .github/workflows/deploy.yml
name: AI-Powered Deployment

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Analyze Repository
        run: |
          curl -X POST http://your-ai-hub.com/github/analyze \
            -H "Content-Type: application/json" \
            -d '{"repo": "${{ github.repository }}"}' \
            > analysis.json
      
      - name: Deploy to Production
        run: |
          # Deployment logic
          docker-compose up -d
          
      - name: Update AI-Hub
        run: |
          # Container bilgilerini güncelle
          curl -X GET http://your-ai-hub.com/docker/containers
          
      - name: Notify Team
        run: |
          curl -X POST http://your-ai-hub.com/slack/message \
            -H "Content-Type: application/json" \
            -d '{
              "channel": "#deployments",
              "text": "🚀 ${{ github.repository }} deployed to production",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Deployment Details:*\n• Repo: ${{ github.repository }}\n• Commit: ${{ github.sha }}\n• Branch: ${{ github.ref_name }}"
                  }
                }
              ]
            }'
```

## 3. Business Process Automation

### 3.1 Customer Support Workflow

**Senaryo:** Müşteri taleplerini otomatik yönet ve çözüm öner.

```python
class CustomerSupportAI:
    def __init__(self):
        self.ai_hub = AIHubClient()
    
    def process_support_request(self, customer_email, issue_description):
        """Müşteri destek talebini işle"""
        
        # 1. Talebi Notion'a kaydet
        ticket = self.ai_hub.create_notion_task(
            gorev=f"Support: {customer_email} - {issue_description[:50]}...",
            proje_id="support_board_id"
        )
        
        # 2. AI ile analiz et
        analysis = self.analyze_issue_with_ai(issue_description)
        
        # 3. Destek kanalına bildir
        self.ai_hub.send_slack_message(
            "#customer-support",
            f"🎫 New Support Request\n" +
            f"👤 Customer: {customer_email}\n" +
            f"📝 Issue: {issue_description}\n" +
            f"🤖 AI Analysis: {analysis['category']}\n" +
            f"🎯 Priority: {analysis['priority']}\n" +
            f"🎫 Ticket: {ticket['task']['url']}"
        )
        
        # 4. Otomatik çözüm öner
        if analysis['auto_solvable']:
            solution = self.generate_solution(analysis)
            
            self.ai_hub.send_slack_message(
                customer_email,
                f"💡 Auto-solution suggestion:\n{solution}"
            )
        
        return ticket
    
    def analyze_issue_with_ai(self, description):
        """AI ile destek talebini analiz et"""
        # LLM çağrısı yap
        prompt = f"""
        Analyze this customer support request:
        {description}
        
        Categorize as:
        - Technical Issue
        - Billing Question  
        - Feature Request
        - Account Problem
        
        Assign priority: Low/Medium/High/Critical
        
        Can be auto-solved? Yes/No
        """
        
        # AI API çağrısı...
        return {
            "category": "Technical Issue",
            "priority": "Medium",
            "auto_solvable": True
        }
```

### 3.2 Project Management Automation

**Senaryo:** Proje yönetim sürecini otomatikleştir.

```javascript
class ProjectManager {
    constructor() {
        this.aiHub = new AIHubClient();
    }
    
    async createProjectFromIdea(idea) {
        // 1. AI ile proje planı oluştur
        const plan = await this.generateProjectPlan(idea);
        
        // 2. Notion'da proje oluştur
        const project = await this.aiHub.createNotionProject({
            name: plan.title,
            status: "Yapılmadı",
            tasks: plan.tasks
        });
        
        // 3. GitHub repository oluştur (varsa)
        if (plan.needsRepo) {
            const repo = await this.createGitHubRepository(plan.title);
            
            // 4. Team bildirimi
            await this.aiHub.sendSlackMessage(
                "#projects",
                `🆕 New Project Started\n` +
                `📁 Project: ${plan.title}\n` +
                `🔗 Repo: ${repo.html_url}\n` +
                `📋 Notion: ${project.project.url}`
            );
        }
        
        return project;
    }
    
    async generateProjectPlan(idea) {
        // AI ile proje planı oluştur
        const response = await this.callAI({
            prompt: `Create a project plan for: ${idea}`,
            context: "Break down into specific, actionable tasks with timelines"
        });
        
        return {
            title: response.title,
            tasks: response.tasks,
            needsRepo: response.requires_repository,
            estimatedDays: response.estimated_days
        };
    }
    
    async monitorProjectProgress(projectId) {
        // Proje ilerlemini monitor et
        const project = await this.aiHub.getNotionProject(projectId);
        const tasks = await this.aiHub.getProjectTasks(projectId);
        
        const completed = tasks.filter(t => t.status === "Done").length;
        const total = tasks.length;
        const progress = (completed / total) * 100;
        
        // İlerleme güncellemesi
        if (progress > 0 && progress % 25 === 0) {
            await this.aiHub.sendSlackMessage(
                "#projects",
                `📊 Project Progress: ${Math.round(progress)}%\n` +
                `✅ Completed: ${completed}/${total} tasks`
            );
        }
        
        return { progress, completed, total };
    }
}
```

## 4. Data Analysis and Reporting

### 4.1 Repository Analytics Dashboard

**Senaryo:** Birden fazla repository'nın analizini birleştir.

```python
class RepoAnalytics:
    def __init__(self):
        self.ai_hub = AIHubClient()
    
    def generate_team_dashboard(self, repos):
        """Team repository'ları için dashboard oluştur"""
        
        analytics = []
        
        for repo in repos:
            # Repository analiz et
            analysis = self.ai_hub.analyze_repo(repo)
            
            # Metrikleri hesapla
            metrics = self.calculate_metrics(analysis)
            
            analytics.append({
                'repo': repo,
                'metrics': metrics,
                'health_score': self.calculate_health_score(metrics)
            })
        
        # Dashboard oluştur
        dashboard = self.create_dashboard(analytics)
        
        # Slack'e gönder
        self.ai_hub.send_slack_message(
            "#analytics",
            "📊 Weekly Repository Dashboard",
            blocks=[dashboard]
        )
        
        return analytics
    
    def calculate_metrics(self, analysis):
        """Repository metriklerini hesapla"""
        return {
            'stars': analysis['repo']['stars'],
            'open_issues': analysis['issues']['open'],
            'recent_commits': len(analysis['commits']['items']),
            'contributors': self.count_contributors(analysis),
            'language': analysis['repo']['language'],
            'last_updated': analysis['repo']['pushedAt']
        }
    
    def create_dashboard(self, analytics):
        """Slack dashboard blokları oluştur"""
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "📊 Repository Analytics Dashboard"
                }
            }
        ]
        
        for repo_data in analytics:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{repo_data['repo']}*\n" +
                             f"⭐ Stars: {repo_data['metrics']['stars']}\n" +
                             f"🐛 Issues: {repo_data['metrics']['open_issues']}\n" +
                             f"👥 Commits: {repo_data['metrics']['recent_commits']}\n" +
                             f"💻 Language: {repo_data['metrics']['language']}\n" +
                             f"🏥 Health: {repo_data['health_score']}/100"
                }
            })
        
        return blocks
```

### 4.2 Automated Reporting

**Senaryo:** Haftalık otomatik raporlama sistemi.

```javascript
class AutomatedReporter {
    constructor() {
        this.aiHub = new AIHubClient();
    }
    
    async generateWeeklyReport() {
        const report = {
            period: this.getWeekPeriod(),
            sections: {}
        };
        
        // 1. Development Activity
        report.sections.development = await this.getDevelopmentStats();
        
        // 2. Infrastructure Health
        report.sections.infrastructure = await this.getInfrastructureHealth();
        
        // 3. Project Progress
        report.sections.projects = await this.getProjectProgress();
        
        // 4. Team Productivity
        report.sections.productivity = await this.getProductivityMetrics();
        
        // 5. Raporu gönder
        await this.sendReport(report);
        
        return report;
    }
    
    async getDevelopmentStats() {
        // GitHub'dan haftalık aktivite
        const commits = await this.aiHub.getWeeklyCommits();
        const prs = await this.aiHub.getWeeklyPRs();
        const issues = await this.aiHub.getWeeklyIssues();
        
        return {
            commits: commits.length,
            pull_requests: prs.length,
            issues_opened: issues.opened,
            issues_closed: issues.closed,
            top_contributors: this.getTopContributors(commits)
        };
    }
    
    async getInfrastructureHealth() {
        // Docker container durumu
        const containers = await this.aiHub.list_containers();
        const running = containers.containers.filter(c => c.state === 'running');
        
        return {
            total_containers: containers.containers.length,
            running_containers: running.length,
            health_score: (running.length / containers.containers.length) * 100
        };
    }
    
    async sendReport(report) {
        const summary = this.generateSummary(report);
        
        // Slack'e gönder
        await this.aiHub.sendSlackMessage(
            "#weekly-reports",
            "📈 Weekly Development Report",
            [summary, ...this.generateDetailBlocks(report)]
        );
        
        // Notion'a kaydet
        await this.aiHub.createNotionTask(
            gorev: `Weekly Report - ${report.period}`,
            proje_id: "reports_project"
        );
    }
}
```

## 5. AI-Powered Workflows

### 5.1 Intelligent Code Assistant

**Senaryo:** AI kod asistanı ile development sürecini iyileştir.

```python
class IntelligentCodeAssistant:
    def __init__(self):
        self.ai_hub = AIHubClient()
    
    async assist_development(self, repository, task_description):
        """Development task'i için AI destekli yardım"""
        
        # 1. Repository context al
        context = self.ai_hub.analyze_repo(repository)
        
        # 2. AI ile kod öner
        suggestion = await self.get_code_suggestion(
            context, 
            task_description
        )
        
        # 3. Implementation planı oluştur
        plan = await self.create_implementation_plan(
            context, 
            suggestion
        )
        
        # 4. Development ortamını hazırla
        await self.setup_development_environment(
            repository, 
            plan
        )
        
        # 5. Team bilgilendir
        await self.ai_hub.send_slack_message(
            "#development",
            f"🤖 AI Assistant started for {repository}\n" +
            f"📝 Task: {task_description}\n" +
            f"💡 Suggestion: {suggestion.summary}\n" +
            f"📋 Plan: {len(plan.steps)} steps"
        )
        
        return {
            context,
            suggestion,
            plan,
            environment_ready: True
        }
    
    async get_code_suggestion(self, context, task):
        """AI ile kod önerisi oluştur"""
        prompt = f"""
        Based on this repository context:
        - Language: {context['repo']['language']}
        - Structure: {[f['path'] for f in context['tree']['items'][:10]]}
        - Recent issues: {context['issues']['items'][:3]}
        
        Provide implementation suggestions for: {task}
        
        Include:
        1. Best practices for this language
        2. Relevant existing code patterns
        3. Potential pitfalls to avoid
        4. Testing recommendations
        """
        
        # AI API çağrısı...
        return {
            "summary": "Use React hooks with proper error handling",
            "code_snippet": "...",
            "best_practices": ["...", "..."],
            "testing": ["...", "..."]
        }
```

### 5.2 Automated Testing Integration

**Senaryo:** Test süreçlerini AI-Hub ile otomatikleştir.

```javascript
class AutomatedTesting {
    constructor() {
        this.aiHub = new AIHubClient();
    }
    
    async runTestSuite(repository, test_type = 'all') {
        // 1. Repository'de testleri çalıştır
        const testResults = await this.runTests(repository, test_type);
        
        // 2. Sonuçları analiz et
        const analysis = this.analyzeTestResults(testResults);
        
        // 3. Hata varsa bildir
        if (analysis.failed_tests > 0) {
            await this.notifyTestFailures(analysis);
            
            // 4. AI ile çözüm öner
            const suggestions = await this.getFixSuggestions(analysis);
            await this.sendSuggestions(suggestions);
        }
        
        // 5. Test sonuçlarını kaydet
        await this.saveTestResults(analysis);
        
        return analysis;
    }
    
    async notifyTestFailures(analysis) {
        const message = {
            text: `❌ Test Failures Detected\n` +
                   `📊 Total: ${analysis.total_tests}\n` +
                   `✅ Passed: ${analysis.passed_tests}\n` +
                   `❌ Failed: ${analysis.failed_tests}\n` +
                   `⏱️ Duration: ${analysis.duration}ms`,
            blocks: this.createFailureBlocks(analysis)
        };
        
        await this.aiHub.sendSlackMessage("#testing", message.text, message.blocks);
    }
    
    async getFixSuggestions(failures) {
        // AI ile hata çözüm önerileri
        const prompt = `
        Analyze these test failures and suggest fixes:
        ${JSON.stringify(failures, null, 2)}
        
        For each failure, provide:
        1. Root cause analysis
        2. Specific fix recommendations
        3. Prevention strategies
        `;
        
        // AI API çağrısı...
        return suggestions;
    }
}
```

## Best Practices

### 1. Error Handling
- Tüm API çağrılarında error handling implement edin
- Fallback mekanizmaları kurun
- User-friendly error mesajları gösterin

### 2. Rate Limiting
- API rate limit'lerine dikkat edin
- Cache mekanizması kullanın
- Backoff strategy implement edin

### 3. Security
- API keys'i güvenli saklayın
- Minimum required permissions verin
- Input validation yapın

### 4. Monitoring
- Request/response log'ları tutun
- Performance metrikleri izleyin
- Alert mekanizmaları kurun

Bu use case'ler ile AI-Hub'ın gücünden maksimum faydalanabilirsiniz!
