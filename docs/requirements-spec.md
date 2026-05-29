# Project Management Assistant - Software Requirements Specification
# 项目管理助手 - 软件需求规格说明书

> Version: 1.0
> Date: 2026-05-21
> Language: Chinese (Main) / English (Technical Terms)

---

## 1. Product Overview / 产品概述

### 1.1 Background / 背景介绍

基于公司现有项目、产品的工作流，实现一个可以辅助项目管理的自动化助手，解决多项目、多产品公司内部的项目管理混乱和困难问题。

**Objective**: Create an automated project management assistant that aggregates data from existing systems (Zentao, Gitlab, NAS) to provide real-time project status, progress tracking, and delivery management.

### 1.2 Scope / 产品范围

**Core Features / 核心功能**:
- Project progress tracking (Gantt view / 甘特图视图)
- Project phase status and blocker identification
- Product-Project-Customer relationship mapping (关系图谱)
- Document delivery management (软硬件交付资料管理)
- Delivery status tracking (交付状态追踪)
- Project reporting (日报/周报/月报/季报/年报)

**Project Types / 项目类型**:
- R&D Project (研发项目): Full development cycle
- Production Project (生产项目): Simplified cycle for repeat orders

**Target Users / 目标用户**:
- Project Managers (项目经理)
- CTO / CEO
- Hardware/Software Developers (硬件/软件开发)
- QA Team (测试交付)
- Sales & Pre-sales (销售及售前)

---

## 2. System Architecture / 系统架构

### 2.1 Data Sources / 数据源

| System / 系统 | URL / 地址 | Purpose / 用途 |
|--------------|-----------|---------------|
| 禅道 (Zentao) | http://192.168.0.124:8800 | Project tasks, milestones, releases |
| Gitlab | http://192.168.0.128/ | Source code, releases, documentation |
| NAS File Server | 192.168.0.180 | Pre-sales documents, delivery files |

**Data Strategy / 数据策略**: 
- Primary: Read-only integration from 禅道/Gitlab/NAS
- Optional: Local database (SQLite/PostgreSQL) for data caching and aggregation based on performance requirements
- 系统可反向规范禅道操作流程和任务命名

### 2.2 Technical Constraints / 技术约束

- **Platform**: Web-based application (浏览器访问)
- **Storage**: 根据功能和性能需求，可使用本地数据库进行数据缓存（可选）
- **Priority Features**: 项目进度视图、产品项目映射、交付资料管理

---

## 3. Functional Requirements / 功能需求

### 3.1 Project Progress View / 项目进度视图

**FR-001**: Display overall project progress and progress for each phase
- 显示总体进度和各阶段进度
- Support Gantt chart visualization / 支持甘特图可视化

**FR-002**: Display current status of each project phase
- 售前 → 项目立项 → 需求分解 → 硬件开发 → BSP开发 → 软件开发 → 测试 → 产品发货 → 项目总结

**FR-003**: Identify blockers and responsible persons for each phase
- 显示各阶段的卡点和对应责任人信息
- Alert when phase is blocked / 卡点告警

**FR-004**: Project risk automatic notification
- 项目风险自动提示
- Trigger alerts based on task completion status and missing deliverables

**FR-026**: Dashboard category filter cards (首页分类筛选卡片)
- 顶部4个卡片作为项目分类入口: 进行中 (In Progress)、已完成 (Completed)、高风险 (High Risk)、资料不全 (Incomplete Docs)
- 点击卡片后下方项目列表自动过滤出对应分类的项目
- 当前选中的卡片突出显示（高亮边框或背景色），明确指示当前筛选类型
- 卡片上显示各分类的项目数量统计

**Category Definitions / 分类定义**:
| 分类 | 筛选规则 | 卡片颜色 |
|------|---------|---------|
| 进行中 (In Progress) | 项目状态 != 已完成 (Completed) | 🟢 绿色/蓝色 |
| 已完成 (Completed) | 项目状态 = 已完成 | ⚪ 灰色/绿色 |
| 高风险 (High Risk) | 存在阶段超期或阻塞卡点 | 🔴 红色 |
| 资料不全 (Incomplete Docs) | 存在输出件缺失或Gitlab未发布 | 🟡 黄色/橙色 |

### 3.2 Product-Project-Customer Mapping / 产品项目客户映射

**FR-005**: Relationship view similar to Obsidian/Xmind graph
- 从项目角度快速查看产品组成
- 从项目角度快速查看对应的客户信息
- 从产品的角度查看应用到了哪些项目
- 从产品的角度查看应用到了哪些客户
- 从客户的角度查看涉及到哪些项目
- 从客户的角度查看购买过哪些产品

**FR-006**: Interactive graph navigation
- 支持三者相互查询对应关系
- Click to drill down / 点击钻取

### 3.3 Delivery Document Management / 交付文档管理

**FR-007**: Hardware delivery materials (硬件交付资料)
| Material Type / 物料类型 | Output Path / 输出路径 | Access Permission / 访问权限 |
|-------------------------|------------------------|------------------------------|
| 原理图 (Schematic) | NAS/Gitlab | 🔒 NAS: 受控 |
| Layout | NAS/Gitlab | 🔓 公开 (项目成员可访问) |
| BOM清单 (BOM List) | NAS/Gitlab | 🔓 公开 (项目成员可访问) |
| 硬件采购清单 | NAS | 🔓 公开 (项目成员可访问) |
| 中间件清单 | NAS | 🔓 公开 (项目成员可访问) |
| 软硬件交互文档 | NAS/Gitlab/禅道 | 🔓 公开 (项目成员可访问) |
| 结构交互文档 | NAS/Gitlab/禅道 | 🔓 公开 (项目成员可访问) |
| 硬件调试记录 | Gitlab/禅道 | 🔓 公开 (项目成员可查) |
| BOM定稿 | NAS/Gitlab/禅道 | 🔓 公开 (项目成员可访问) |

**FR-008**: Software delivery materials (软件交付资料)
| Material Type / 物料类型 | Output Path / 输出路径 | Access Permission / 访问权限 |
|-------------------------|------------------------|------------------------------|
| Gitlab仓库源码链接 | Gitlab | 🔒 受控 (项目成员可访问) |
| 最新版本发布的路径 | Gitlab | 🔓 公开 (项目成员可访问) |
| 交付文档链接 | Gitlab | 🔓 公开 (项目成员可访问) |

> **图标说明 / Legend**: 🔒 受控 = 需要权限控制 | 🔓 公开 = 团队成员可访问

**FR-009**: Quick link jump / 链接快捷跳转
- 每个项目对应的产品的软硬件交付资料可以通过链接快速跳转查看
- 每个产品可以对应的所有项目的软硬件资料也可以快速查询

**FR-010**: Document preview support / 文档预览
- 支持直接预览常见文件类型: Word, PDF, TXT, MD, html, 常见图片(jpg,png,bmp,svg等)
- Office文件需要转换为可预览格式

> **📝 权限管理说明 / Permission Note**:
> - 对于有权限管理要求的交付资料，统一放到NAS服务器（方便控制权限）
> - 在禅道上只需要提供NAS链接即可，本系统检测时仅检查链接是否存在，**暂不验证链接有效性**
> - 链接格式示例: `\\192.168.0.180\硬件资料\PE0444\原理图.pdf` 或 `NAS://硬件资料/PE0444/原理图.pdf`

### 3.4 Delivery Status Tracking / 交付状态追踪

**FR-011**: Display delivery status per project
- 应交付总数 (Total Expected)
- 已交付数量 (Delivered Count)
- 已交付编号 (Delivered Serial Numbers)
- 交付时间 (Delivery Time)
- 剩余未交付数量及原因 (Remaining & Reasons)

### 3.5 Project Type Differentiation / 项目类型区分

**FR-012**: Distinguish R&D vs Production projects
- 研发项目 (R&D Project): Full development cycle required
- 生产项目 (Production Project): No R&D needed, only BOM确认、采购、生产、结构安装、测试交付

### 3.6 Statistics & Reports / 统计报表

**FR-013**: Bug statistics / Bug统计
- From 禅道 bug module

**FR-014**: Gitlab commit statistics / Gitlab提交统计

**FR-015**: Project reports / 项目报表
- 日报 (Daily)
- 周报 (Weekly)
- 月报 (Monthly)
- 季报 (Quarterly)
- 年报 (Yearly)

### 3.7 Outsourcing Tracking / 外协进度跟踪

**FR-022**: Outsourcing progress tracking (外协进度跟踪)
- Track outsourcing progress and regularly update to task progress / 跟踪外协进度并定期更新到任务进度中
- Outsourcing acceptance (outsourcing validation) / 外协验收【项目经理，质量】
- Display outsourcing contract numbers / 显示外协合同编号
- Link to outsourcing technical agreement / 外协技术协议书（可以是链接形式）

**Outsourcing Workflow / 外协流程**:
1. 创建外协进度跟踪任务【项目经理负责跟踪进度】
2. 外协技术协议书签署
3. 外协合同签署 (提供编号)
4. 执行进度监控
5. 外协验收 → 输出验收报告

### 3.8 Product Management / 产品管理

**FR-027**: Product list with category filtering and search (产品列表及分类筛选搜索)
- 左侧按产品线分类（存储/频谱/航电/电磁/综合），点击分类快速过滤对应产品列表
- 产品列表支持模糊搜索: 基于产品名、产品标签 (Product Tags) 等关键词搜索
- 产品列表包含信息: 产品名 (Product Name)、产品描述 (Product Description)、产品标签 (Product Tags)
- 点击产品列表中的具体产品，自动跳转到对应的产品详情页

**FR-028**: Product tags extraction from Zentao (产品标签提取)
- 产品标签从禅道产品描述字段中按关键词提取
- 标签格式: `#关键词` (e.g., `#全国产`、`#双V7`、`#PCIe卡`、`#采集存储一体机`、`#采集回放`)
- 常见标签关键词参考: 全国产、双V7、单V7、PCIe卡、PXIe卡、VPX卡、采集存储一体机、采集回放、信号处理、频谱监测、航电仿真、电磁兼容等
- 系统自动解析禅道产品描述中的 `#标签` 并展示在产品列表和详情页中

**FR-029**: Product detail page (产品详情页)
- 展示从禅道获取的所有产品信息，按照统一风格呈现
- 至少包含: 产品名称、产品描述、产品线分类、产品标签、关联项目列表、关联客户列表
- 关联项目支持点击跳转到对应项目详情页
- 产品详情页包含产品的软硬件交付资料汇总（关联自 FR-007/FR-008）

---

## 4. Process & Workflow / 流程定义

### 4.1 Project Lifecycle / 项目全生命周期

```
售前 (Pre-sales)
    ├── 需求导入 (Requirement Input)
    ├── 需求评估 (Requirement Assessment)
    │   ├── 技术可行性报告 (Technical Feasibility)
    │   ├── 商务可行性报告 (Business Feasibility)
    │   └── 综合可行性报告 (Comprehensive Feasibility)
    └── 项目立项决策 (Project Initiation Decision)
        ├── 立项决议书
        └── 转研发/生产项目

项目立项 (Project Initiation)
    ├── 创建禅道项目
    ├── 实施方案草案
    └── 项目启动会
        ├── 人力资源排布
        └── 项目周期计划

需求分解 (Requirement Decomposition)
    ├── 研发项目: 硬件/结构/采购/外协/BSP/软件/测试/交付 需求分解
    ├── 生产项目: 硬件/结构/测试/交付 需求分解
    └── 输出: 禅道开发任务

硬件开发 (Hardware Development) [研发项目 - 可并行]
    ├── 硬件设计 (原理图 + Layout) 【硬件开发】
    │   └── 输出: 原理图、评审意见表、PCB设计交互文档、软硬件交互文档
    ├── 器件选型确认 (与硬件设计并行) 【采购 + 硬件开发】
    │   └── 输出: 器件清单确认
    ├── 结构设计 【结构设计及装配】
    │   └── 输出: 结构设计文档、结构装配指导书
    ├── BOM清单 & ERP录入 【硬件开发】
    ├── 物料采购 【采购】
    ├── PCB生产 【项目经理】
    ├── IQC物料质检 【质检】
    ├── PCB焊接 (外包) 【项目经理】
    ├── 焊接质检 【质检】
    ├── 硬件调试 【硬件测试】
    │   └── 输出: 硬件调试记录 (Gitlab)
    └── 结构装配 【结构设计及装配】

硬件开发 (Hardware Development) [生产项目 - 简化流程]
    ├── 清单版本确认 【硬件开发】
    │   └── 输出: BOM确认、ERP录入
    ├── 结构版本确认 【结构设计及装配】
    ├── 物料采购 【采购】
    ├── PCB生产+焊接 【项目经理】
    ├── IQC+焊接质检 【质检】
    ├── 硬件调试 【硬件开发】
    │   └── 输出: 硬件调试记录 (Gitlab)
    ├── 硬件测试 【硬件测试】
    └── 结构装配 【结构设计及装配】

BSP开发 (BSP Development) [仅研发]
    ├── 资料准备 (核心器件、软硬件交互文档)
    ├── 需求子任务执行
    └── 版本发布 (禅道版本页面 → Gitlab发布页面)

软件开发 (Software Development) [仅研发]
    ├── 方案概述
    ├── 需求子任务执行
    └── 版本发布 (禅道版本页面 → Gitlab发布页面)

外协进度跟踪 (Outsourcing Tracking) [与软硬件开发并行]
    ├── 外协技术协议书
    ├── 外协合同 (编号)
    └── 外协验收

测试 (Testing)
    ├── 测试大纲编写评审
    ├── 执行测试
    └── 测试文档输出

产品发货 (Product Delivery)
    └── 发货记录 (数量、时间、产品照片、收发人)

项目总结 (Project Summary)
```

### 4.2 Phase Completion Criteria / 阶段完成判定

**Completion Rules / 完成判定规则**:

1. **任务状态检测**: 禅道任务状态必须为"已完成" (Status = Done)

2. **关键字检测配置** (可配置化):
   - 仅涉及他人审核确认的任务需要检测关键字【同意】/【不同意】
   - 纯开发调试任务只需关注任务状态和输出件
   - 通过任务标题关键字标记决定是否检测（如: 任务标题包含"评审"、"确认"、"审核"等关键字时触发）
   - 可在管理后台配置各阶段的关键字规则

3. **输出件检测配置** (可配置化):
   - 各阶段需要检测的输出件可通过配置指定
   - 兼容禅道任务标题中的标记来检测输出件要求
   - 例如: 任务标题包含"【输出件:原理图】"则检测对应文件

4. **Gitlab发布检测**:
   - 需要版本发布的阶段，检测Gitlab对应发布界面是否满足公司规范
   - 参考: http://192.168.0.128/standardization/rd/standard/git-rel

5. **告警触发**:
   - 如果禅道任务已完成但无对应输出件 → 告警

**Alert Rules / 告警规则**:
| 告警类型 | 触发条件 | 颜色 |
|---------|---------|------|
| 阶段超期 | 阶段计划结束日期已过但状态未完成 | 🔴 红色 |
| 输出件缺失 | 任务状态=已完成 但无对应输出件 | 🟡 黄色 |
| Gitlab未发布 | 需要发布的任务无Gitlab release | 🟡 黄色 |
| 关键字缺失 | 审核类任务描述中无【同意】关键字 | 🟡 黄色 |

### 4.3 Pre-sales Project Detection / 售前项目识别

**FR-016**: Monitor NAS server folder for pre-sales projects
- Folder naming pattern: `LSJxxxx`
- Auto-detect new pre-sales projects
- Path to be provided during implementation

---

## 5. Data Model / 数据模型

### 5.1 Core Entities / 核心实体

```
Project (项目)
├── project_id: 项目编号 (e.g., PE0444)
├── project_code: 项目代号 (format: PE0444_CDYA_国产采集存储)
├── project_name: 项目名称
├── project_type: 项目类型 [R&D, Production]
├── customer: 客户
├── products: 产品列表 []
├── status: 项目状态
├── phases: 阶段列表 []
├── start_date: 开始日期
├── end_date: 结束日期
├── responsible_person: 责任人
└── deliverables: 交付物列表 []

Product (产品)
├── product_id: 产品ID
├── product_name: 产品名称
├── category: 产品分类 (存储/频谱/航电/电磁/综合)
├── projects: 应用项目列表 []
├── customers: 客户列表 []
├── hardware_deliverables: 硬件交付资料 []
└── software_deliverables: 软件交付资料 []

Customer (客户)
├── customer_id: 客户ID
├── customer_name: 客户名称
├── customer_abbrev: 客户简称 (e.g., CDYA, YZYA)
├── projects: 项目列表 []
└── products: 产品列表 []

Phase (阶段)
├── phase_id: 阶段ID
├── phase_name: 阶段名称
├── status: 状态 [Not Started, In Progress, Completed, Blocked]
├── progress: 进度百分比
├── responsible_person: 责任人
├── start_date: 开始日期
├── end_date: 结束日期
├── blockers: 卡点列表 []
└── completion_date: 完成日期

Deliverable (交付物)
├── deliverable_id: 交付物ID
├── deliverable_name: 交付物名称
├── deliverable_type: 类型 [Hardware, Software, Document]
├── project_id: 所属项目
├── status: 状态 [Pending, Delivered]
├── delivery_date: 交付日期
├── delivery_serial_numbers: 已交付编号 []
├── source_path: 源路径 (NAS/Gitlab)
└── preview_url: 预览链接
```

### 5.2 Relationships / 关系定义

```
Product ↔ Project: Many-to-Many (一个产品应用到多个项目)
Project ↔ Customer: Many-to-One (多个项目对应一个客户)
Customer ↔ Product: Many-to-Many (一个客户购买多个产品)
Project → Phase: One-to-Many (一个项目多个阶段)
Phase → Deliverable: One-to-Many
```

---

## 6. UI/UX Requirements / 界面需求

### 6.1 Page Structure / 页面结构

参考 pm-platform.html Demo 页面结构:

| Page / 页面 | Description / 描述 | Demo对应 |
|------------|------------------|----------|
| 首页 (Home) | Dashboard with project overview, KPI cards, alerts | view-dashboard |
| 项目列表 (Project List) | Searchable list with filters, tabs | 项目列表区域 |
| 项目详情 (Project Detail) | Gantt, stages, docs, delivery, resources tabs | view-detail |
| 产品映射 (Product Mapping) | Product↔Project关系图谱, 4种视图 | view-mapping |
| 交付管理 (Delivery Management) | 交付状态追踪 | 交付状态Tab |
| 报表中心 (Reports) | 统计报告 | 统计报告(即将上线) |
| 产品列表 (Product List) | 按产品线分类浏览，支持搜索和标签筛选 | (新增) |
| 产品详情 (Product Detail) | 产品完整信息、关联项目、交付资料汇总 | (新增) |

**页面公共组件** (参考Demo):
- 左侧Sidebar: 品牌Logo + 导航菜单 + 数据源状态 + 主题切换
- 顶部Topbar: 页面标题 + 通知按钮 + 用户信息
- 数据源状态: GitLab/禅道/NAS连接状态指示器

### 6.2 UI Features / 界面功能

**FR-017**: Quick search box on project list
- 支持模糊搜索项目代号、名字、客户等
- 搜索框位于项目列表上方，带搜索图标

**FR-018**: PM icon click to navigate to home
- 侧边栏品牌Logo点击可跳转回首页
- Demo: `onclick="gotoView('dashboard')"`

**FR-019**: Display completion date explicitly
- 涉及项目状态和交付件的页面增加显式对应的完成时间
- 阶段表格中显示"✓ 完成日期"
- 文档齐套表中显示完成时间

**FR-020**: Project code naming convention
- 项目代号命名规则: 项目编号_用户简称_项目属性
- Example: PE0444_CDYA_国产采集存储
- 项目编号示例: PE0444, PE0406
- 用户简称示例: CDYA, YZYA, CDLY
- 项目属性示例: 国产采集存储, 40通道采集存储

**FR-021**: Tab display change (参考Demo: 类型筛选Tab)
- 项目列表Tab从 `RD`/`SC` 改为: "全部" / "研发项目" / "生产项目"
- 项目图标显示项目类型(RD绿色/SC蓝色)
- 项目单元格显示: 项目编号 + 项目属性(客户简称)

**FR-022**: Alert badge & notification
- 侧边栏导航显示待处理告警数量badge
- 顶部通知按钮显示红点提示
- 告警列表按严重程度分类显示

**FR-023**: Gantt chart with today line (参考Demo)
- 甘特图显示时间轴(年/月)
- 今日竖线(today line)标识当前日期
- 阶段条颜色: 已完成(绿色)/进行中(蓝色)/阻塞(红色)/规划中(黄色)/未开始(灰色)

**FR-024**: Data source status component
- 侧边栏底部显示数据源连接状态
- 显示GitLab/禅道/NAS的连接状态(已配置/警告/错误)
- 鼠标悬停显示详细信息(tooltip)

**FR-025**: Theme switching
- 支持浅色/深色主题切换
- Demo: 通过`data-theme="light/dark"`控制

**FR-030**: Product sidebar navigation (产品侧边栏导航)
- 左侧Sidebar增加与"工作台"、"报表"同级的"产品"分类
- "产品"分类下至少包含"产品列表"、"产品详情"两个选项卡
- 产品列表按产品线分类（存储/频谱/航电/电磁/综合），点击分类快速过滤
- 当前选中的产品和产品线分类高亮显示

**FR-031**: Product list card style (产品列表卡片样式)
- 产品列表以卡片形式展示，每个卡片包含: 产品名、产品描述（截断显示）、产品标签（标签气泡样式）
- 产品标签以 `#标签名` 气泡/badge 形式展示，颜色区分不同类别标签
- 支持产品名和标签的模糊搜索，搜索框位于产品列表上方
- 搜索结果实时过滤，高亮匹配关键词

---

## 7. Integration Specifications / 集成规格

### 7.1 禅道 (Zentao) Integration

**API Endpoints Required / 需要的API端点**:
- `/api/projects` - 获取项目列表
- `/api/tasks` - 获取任务列表
- `/api/bugs` - 获取Bug列表
- `/api/releases` - 获取发布信息
- `/api/users` - 获取用户信息

**Data Mapping / 数据映射**:
| 禅道字段 | 本系统字段 |
|---------|-----------|
| project | Project |
| task | Phase Task |
| bug | Bug |
| release | Software Release |

### 7.2 Gitlab Integration

**API Endpoints Required / 需要的API端点**:
- `/api/v4/projects` - 获取项目仓库
- `/api/v4/projects/:id/releases` - 获取发布
- `/api/v4/projects/:id/repository/commits` - 获取提交记录

**Release Validation / 发布验证**:
- 参考公司规范: http://192.168.0.128/standardization/rd/standard/git-rel

### 7.3 NAS Integration

**Pre-sales Monitoring / 售前监控**:
- Folder pattern: `LSJxxxx`
- Monitor for new folders to detect new pre-sales projects
- **TODO**: 售前文件夹根路径待提供 (e.g., `/mnt/nas/pre-sales/`)

---

## 8. Non-Functional Requirements / 非功能需求

### 8.1 Performance / 性能

- Page load time < 3 seconds (页面加载时间 < 3秒)
- Real-time data refresh from source systems (实时数据刷新)
- Support concurrent access for 50+ users (支持50+用户并发)

### 8.2 Security / 安全

- Authentication via company SSO or local auth (公司SSO或本地认证)
- Role-based access control (基于角色的访问控制)
- No sensitive data stored locally (本地不存储敏感数据)

**Role-Based Access Control / 角色权限定义**:

| Role / 角色 | Project View / 项目查看 | Progress View / 进度查看 | Delivery Mgmt / 交付管理 | Reports / 报表 | Admin / 管理 |
|-------------|------------------------|-------------------------|------------------------|---------------|-------------|
| CEO | All | All | All | All | Read-only |
| CTO | All | All | All | All | Read-only |
| 项目经理 | Assigned + All (可配置) | All | All | All | Limited |
| 销售及售前 | 售前项目 + 分配项目 | Assigned only | Assigned only | Assigned only | No |
| 硬件开发 | Assigned only | Assigned only | View only | Own stats | No |
| 结构设计及装配 | Assigned only | Assigned only | View only | Own stats | No |
| BSP开发 | Assigned only | Assigned only | View only | Own stats | No |
| 软件开发 | Assigned only | Assigned only | View only | Own stats | No |
| 测试交付 | Assigned only | Assigned only | All | Assigned only | No |
| 采购 | Assigned only | View only | View only | No | No |
| 质检 | Assigned only | View only | View only | No | No |
| 库房管理 | Assigned only | View only | Delivery records | No | No |

**Data Visibility / 数据可见性**:
- `All`: 查看所有项目数据
- `Assigned only`: 仅查看分配给自己的项目
- `View only`: 仅查看，无编辑权限
- `Limited`: 有限的系统管理权限

### 8.3 Availability / 可用性

- Browser-based access (浏览器访问)
- Support Chrome, Edge, Firefox latest versions
- Responsive design for different screen sizes

### 8.4 Maintainability / 可维护性

- Modular architecture (模块化架构)
- Configuration file for system parameters (配置文件)
- Logging for debugging (日志记录)

---

## 9. Company Structure Reference / 公司结构参考

### 9.1 Positions / 人力岗位

| Position / 岗位 | Description |
|----------------|-------------|
| CEO | 首席运营官 |
| CTO | 首席技术官 |
| 销售及售前 | Sales & Pre-sales |
| 硬件开发 | Hardware Development |
| 结构设计及装配 | Structure Design & Assembly |
| 硬件测试 | Hardware Testing |
| BSP开发 | BSP Development |
| 业务软件开发 | Business Software Development |
| 测试交付 | Testing & Delivery |
| 采购 | Procurement |
| 项目经理 | Project Manager |
| 质检 | Quality Inspection |
| 库房管理 | Warehouse Management |

### 9.2 Product Lines / 公司产线

- 存储 (Storage)
- 频谱 (Spectrum)
- 航电 (Avionics)
- 电磁 (Electromagnetic)
- 综合 (Comprehensive)

---

## 10. Glossary / 术语表

| Term / 术语 | Definition / 定义 |
|------------|------------------|
| 禅道 (Zentao) | 项目管理工具 (Project management tool) |
| 项目编号 (Project ID) | 项目唯一标识, e.g., PE0444 |
| 项目代号 (Project Code) | 项目完整命名: PE0444_CDYA_国产采集存储 |
| 研发项目 (R&D Project) | 需要完整研发流程的项目 |
| 生产项目 (Production Project) | 重复采购项目,无需研发 |
| 交付物 (Deliverable) | 项目阶段产出的文档/物料 |
| 卡点 (Blocker) | 阻碍项目进展的问题点 |
| 软硬件资料 (HW/SW Materials) | Hardware and Software documentation |
| 齐套性 (Completeness) | 文档/物料完整性状态 |
| 售前 (Pre-sales) | 项目正式立项前的商机阶段 |

---

## 11. Out of Scope / 超出范围

- Writing to 禅道/Gitlab (read-only)
- Local data persistence
- Mobile app
- Email/SMS notifications (future enhancement)
- Multi-language UI (currently Chinese only)

---

## 12. Future Enhancements / 未来增强

- [ ] Email/SMS notification system
- [ ] Mobile app support
- [ ] AI-powered risk prediction
- [ ] Integration with additional systems (ERP, CRM)
- [ ] Custom report builder

---

*Document Version History*
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-05-21 | AI Assistant | Initial version based on 需求.md |
