
产品思路：调研work buddy，以这个产品思路为主。
技术和实现：以/data/workspace2026-new/myworker/OpenHands 项目作为输入和参考。实现webui/desktop ui 两个都要。UI+功能要达到商用标准。用户体验简洁有实际价值。

它不再只是 **AI Research Scientist**，而是一个更大的垂直方向：
产品定位已经不是“论文助手”，也不是“知识库工具”，而是：

AI 驱动的知识获取、理解、组织、创新生产系统

命名需要体现三个核心价值：

探索（Discover）：帮用户发现知识
理解（Understand）：形成知识体系
创造（Create）：产出研究、方案、论文

方向一：AI Scientist / AI Research 类（偏专业、高端）
产品名称 Novi

含义：

Novel（创新）
Nova（新星）
Knowledge Innovation

定位：

Novi — Your AI Knowledge Scientist

感觉：

类似：

OpenAI
Perplexity
Notion
Cursor

产品线：

Novi

├── Novi Learn
│   学习任何领域

├── Novi Research
│   深度研究

├── Novi Paper
│   AI论文助手

└── Novi Knowledge
    个人知识库

优点：

简短
国际化
有创新含义

> **AI Knowledge Scientist：个人/企业的 AI 知识研究与生产系统**

但是注意：不要做“万能 AI 助手”。
真正商业化的关键是：

**只做三个极致场景：**

1. **Deep Research（专业研究）**
2. **AI Paper Author（科研论文生产）**
3. **Knowledge Builder（个人知识构建）**

这三个功能其实共享同一个底座：

> Knowledge Intelligence Engine（知识智能引擎）

---

# 产品定位

## AI Knowledge Scientist

一句话：

> 输入一个主题、问题或者想法，AI 自动从全球知识源学习、理解、组织，形成个人知识库，并输出研究报告、学习体系、论文和决策资料。

---

# 三个核心产品模块

```text
                  AI Knowledge Scientist


                         User


                          |
                          |


              Knowledge Intelligence Engine


        ┌─────────────────┼─────────────────┐


        |                 |                 |

   Deep Research     Paper Author     Knowledge Builder


   学术研究          写论文           学习新领域


```

---

# 功能1：Deep Research

目标用户：

* 科研人员
* 技术专家
* 企业研发
* 架构师

输入：

```
研究 Agent OS Security
```

输出：

```
Research Report

+
LLM Wiki

+
Knowledge Graph

+
SOTA Analysis

+
Research Opportunity
```

---

## 数据源

不是只用 arxiv。

应该：

```text
Knowledge Sources


论文:

arxiv
IEEE
ACM
Springer


代码:

GitHub
HuggingFace


技术:

Official Docs
RFC
Standards


社区:

Reddit
StackOverflow


商业:

Blogs
Whitepapers

```

---

# 功能2：AI Paper Author

目标：

研究人员：

```
Idea
 ↓
Paper
```

流程：

```text
Paper Idea


    ↓


Research Gap Discovery


    ↓


Novelty Analysis


    ↓


Contribution Design


    ↓


Method


    ↓


Experiment


    ↓


Paper Draft


    ↓


Review Simulation

```

输出：

```
IEEE/ACM style paper draft

+
LaTeX

+
Figures

+
Experiment Plan

```

---

# 功能3：Knowledge Builder（这个是商业价值最大的）

这个面向普通用户。

场景：

## 用户：

“我要快速学习 Agent OS”

传统：

搜索：

* Google
* YouTube
* Blog
* 文档

花：

几周。

你的产品：

输入：

```
学习 Agent OS
```

输出：

```
Agent OS Knowledge Base


                Agent OS


                    |

        -----------------------

        |          |          |

Architecture Runtime Security


        |          |          |

  agentd     memoryd     sandbox


                    |

             Learning Path


Beginner

   ↓

Intermediate

   ↓

Advanced

   ↓

Expert


```

---

# Knowledge Builder Pipeline

## Step 1：知识采集

自动：

```
Search Engine

+
Wikipedia

+
YouTube

+
Docs

+
Papers

+
Books

+
GitHub

```

---

## Step 2：知识过滤

不是全部保存。

AI 判断：

```
相关性

权威性

新旧程度

可信度

```

---

## Step 3：知识结构化

普通搜索：

```
1000个网页
```

你的：

```
知识树

概念

关系

案例

实践

问题

```

---

## Step 4：生成学习产品

输出：

### LLM Wiki

例如：

```
Docker


1. What

2. Why

3. Architecture

4. Core Components

5. Usage

6. Advanced

7. Interview

8. Project

```

---

### Learning Path

例如：

```
30天学习 Agent


Week1:
LLM基础


Week2:
Agent Framework


Week3:
Memory/RAG


Week4:
Agent OS

```

---

### Knowledge Graph

```
        Agent


          |

    ---------------

    |             |

LLM          Tool


                 |

              MCP


```

---

# 三个功能共享一个核心架构

## Knowledge OS

```text
                       Knowledge OS


                         Memory Layer


        ------------------------------------------------


        Document Memory

        Semantic Memory

        Graph Memory

        Research Memory


                         |


                  Intelligence Engine


        ------------------------------------------------


        Retrieval

        Reasoning

        Summarization

        Generation


```

---

# 技术架构建议

## 1. 数据采集层

```
Crawler

API Connector

Browser Agent

MCP Connector

```

支持：

* arxiv
* GitHub
* Web
* YouTube
* Docs

---

## 2. Knowledge Processing

```text
Document

    ↓

Parser

    ↓

Chunk

    ↓

Embedding

    ↓

Entity Extraction

    ↓

Graph Construction

```

---

## 3. Storage

必须：

### Vector DB

推荐：

* LanceDB
* Milvus

保存：

```
语义搜索
```

---

### Graph DB

推荐：

* Neo4j

保存：

```
知识关系
```

---

### Document DB

PostgreSQL：

保存：

```
用户项目

Workspace

历史任务
```

---

# Agent 架构

不要很多 Agent。

保持简单：

```text
Research Agent


Knowledge Agent


Writing Agent


Review Agent


```

四个即可。

---

# 商业化设计

这是关键。

用户为什么持续付费？

不是因为聊天。

而是：

## 1. Personal Knowledge Asset

用户积累：

```
我的知识库

我的研究

我的学习历史

我的论文

```

形成迁移成本。

---

## 2. Workspace

类似：

```
Notion

+

ChatGPT

+

Research Assistant

```

用户有：

```
项目空间

团队空间

企业知识库
```

---

## 3. Continuous Update

这是订阅理由：

例如：

用户：

```
关注 Agent Security
```

系统每天：

```
新增论文

技术变化

Github更新

行业趋势
```

自动更新 Wiki。

---

# 商业用户

## 个人版

目标：

* 学生
* 工程师
* 技术管理者

价格：

$20~50/月

---

## Pro Research

目标：

* 博士
* 科研人员
* 架构师

价格：

$100/月

---

## Enterprise

目标：

* 企业研发部门

能力：

```
企业知识库

技术情报

竞争分析

研发辅助
```

价格：

$1000+/月

---

# MVP路线

不要三个一起做。

我建议：

## Phase 1（最容易形成壁垒）

Knowledge Builder

原因：

用户最大。

先做到：

```
输入领域

↓

自动生成 LLM Wiki

↓

知识图谱

↓

学习路线

```

---

## Phase 2

Deep Research

增加：

```
论文

SOTA

Research Gap

```

---

## Phase 3

Paper Author

最后：

```
Idea

↓

Paper
```

---

# 最终产品一句话定义

> **一个 AI Knowledge Scientist：帮助用户学习任何领域、研究前沿技术，并将知识转化为论文和创新成果。**

技术核心：

```
Knowledge OS

+
Research Agent

+
Writing Agent

+
Personal Memory

```

