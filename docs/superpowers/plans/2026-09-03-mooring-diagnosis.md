# Mooring Fitting 원인 진단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입력 오류·모델 결함·하중 누락·과대응력의 원인을 사용자에게 문장으로 알려준다.

**Architecture:** 엔진(C#)이 부재별 증거를 조인해 `MODEL_EVIDENCE.json` 으로 내고, 백엔드(Python)가 임계값·우선순위·문장 템플릿을 적용해 `DIAGNOSIS.json` 을 만든다. Studio·보고서·WorkBench 세 화면이 그 한 파일을 읽는다. 조인 로직은 거의 바뀌지 않고 규칙은 자주 바뀌므로, 규칙만 `git pull` 로 반영되게 나눴다.

**Tech Stack:** C# .NET 8 (xunit), Python 3 (pytest), React (MooringFittingStudio / WorkBench 프론트)

**Spec:** `docs/superpowers/specs/2026-09-03-mooring-diagnosis-design.md`

**⚠ 커밋 규칙:** 이 저장소는 **자동 커밋 금지**다. 각 Task 끝에 "커밋 대상" 파일 목록만 제시하고, `git add`/`git commit` 은 **사용자가 직접** 실행한다. 실행자는 커밋하지 말 것.

**⚠ 빌드·테스트 명령**
```bash
cd /c/Coding/WorkBenchSubModule/MooringFitting
dotnet build MooringFitting.sln
dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj
```
```bash
cd /c/Coding/WorkBench/HiTessWorkBenchBackEnd
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v
```

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `src/MooringFitting.Core/Model/ElementOrigin.cs` | 부재 출신 레코드(derived/fabricated) | 신규 |
| `src/MooringFitting.Core/Model/Entities/FeModelContext.cs` | `ElementOrigins` 사이드맵 보관 | 수정 |
| `src/MooringFitting.Pipeline/Core/ModelDiffTracer.cs` | 신규 요소의 부모 기하 매칭 + 출신 전파 | 수정 |
| `src/MooringFitting.App/Io/Json/LineageJsonWriter.cs` | `Derivatives`/`Sources` 역인덱스 | 수정 |
| `src/MooringFitting.App/Io/Json/ModelEvidenceWriter.cs` | `MODEL_EVIDENCE.json` 생성 | 신규 |
| `src/MooringFitting.App/Services/Analysis/LoadPathResolver.cs` | 하중·SPC 절점으로부터의 BFS hop 수 | 신규 |
| `src/MooringFitting.App/Commands/BuildFullCommand.cs` | ModelEvidenceWriter 호출 | 수정 |
| `src/MooringFitting.App/Commands/SolveBdfCommand.cs` | 결과 JSON 에 `propertyId` 추가 | 수정 |
| `src/MooringFitting.App/Services/Reporting/MooringReportBuilder.cs` | 진단 장 출력 | 수정 |
| `app/services/mooring_diagnosis.py` | 판정 규칙 + 문장 조립 (순수 함수) | 신규 |
| `app/services/mooring_fitting_service.py` | solve 후 판정 실행 → `out/DIAGNOSIS.json` | 수정 |
| `src/components/InspectorPanel.jsx` (Studio) | 부재 진단 섹션 | 수정 |
| `src/components/BottomReviewDock.jsx` (Studio) | 케이스 진단 목록 | 수정 |
| `pages/analysis/MooringFittingAssessment.jsx` | 진단 요약 배너 | 수정 |

**분리 근거:** 기하 매칭(`ModelDiffTracer`)과 증거 조립(`ModelEvidenceWriter`)과 판정(`mooring_diagnosis.py`)은 각각 혼자 테스트된다. BFS 는 증거 조립에서 유일하게 그래프를 다루는 부분이라 `LoadPathResolver` 로 떼어 단위 테스트를 붙인다.

---

## Phase A — 추적 복구 (엔진)

현재 최종 요소 1,748개 중 302개(17%)만 이력을 가진다. Phase A 가 끝나면 **전부**가 `derived` 또는 `fabricated` 출신을 갖는다.

### Task 1: `ElementOrigin` 타입

**Files:**
- Create: `src/MooringFitting.Core/Model/ElementOrigin.cs`

- [ ] **Step 1: 타입을 작성한다**

```csharp
namespace MooringFitting.Model
{
  /// <summary>부재의 출신. 진단이 "이 부재는 어디서 왔는가"에 답하는 근거.</summary>
  public enum OriginKind
  {
    /// <summary>원 도면(CSV) 행에서 유래. 분할·정렬을 거쳤어도 원본 행이 있다.</summary>
    Derived,

    /// <summary>
    /// 엔진이 만들어낸 부재. 자유단 연장·collapse 처럼 원 도면에 대응 행이 없다.
    /// 여기에 억지로 부모를 붙이면 "CSV N행 때문"이라는 거짓 설명이 나오므로 구분한다.
    /// </summary>
    Fabricated
  }

  /// <summary>
  /// 부재 1개의 출신 기록. FeModelContext.ElementOrigins 에 elementId 로 보관된다.
  /// Derived 면 RawKind/RawLineNumber/RawId 가 채워지고, Fabricated 면 Stage/Operation 이 채워진다.
  /// Chain 은 사람이 읽는 변환 경로(예: ["00_BuildRaw", "05_MeshRefinement(3분할)"]).
  /// </summary>
  public sealed record ElementOrigin(
      OriginKind Kind,
      string RawKind = "",
      int RawLineNumber = 0,
      string RawId = "",
      string Stage = "",
      string Operation = "",
      IReadOnlyList<string>? Chain = null)
  {
    /// <summary>변환 단계 하나를 덧붙인 새 출신을 만든다(원본은 불변).</summary>
    public ElementOrigin WithStep(string step)
    {
      var chain = new List<string>(Chain ?? new List<string>()) { step };
      return this with { Chain = chain };
    }
  }
}
```

- [ ] **Step 2: 빌드**

Run: `cd /c/Coding/WorkBenchSubModule/MooringFitting && dotnet build MooringFitting.sln`
Expected: 0 errors

**커밋 대상:** `src/MooringFitting.Core/Model/ElementOrigin.cs`

---

### Task 2: `FeModelContext.ElementOrigins`

**Files:**
- Modify: `src/MooringFitting.Core/Model/Entities/FeModelContext.cs`
- Test: `src/MooringFitting.Tests/ElementOriginTests.cs`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```csharp
using MooringFitting.Model;
using MooringFitting.Model.Entities;
using Xunit;

namespace MooringFitting.Tests
{
    public class ElementOriginTests
    {
        [Fact]
        public void SetOrigin_ThenGet_ReturnsSameRecord()
        {
            var model = FeModelContext.CreateEmpty();
            var origin = new ElementOrigin(OriginKind.Derived, RawKind: "Angle", RawLineNumber: 198, RawId: "HSTIFF");

            model.SetElementOrigin(5, origin);

            Assert.True(model.ElementOrigins.ContainsKey(5));
            Assert.Equal(198, model.ElementOrigins[5].RawLineNumber);
        }

        [Fact]
        public void WithStep_AppendsToChain_AndKeepsOriginalImmutable()
        {
            var origin = new ElementOrigin(OriginKind.Derived, RawKind: "Angle", RawLineNumber: 198);

            var stepped = origin.WithStep("05_MeshRefinement(3분할)");

            Assert.Null(origin.Chain);
            Assert.Single(stepped.Chain!);
            Assert.Equal("05_MeshRefinement(3분할)", stepped.Chain![0]);
        }
    }
}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter ElementOriginTests`
Expected: 컴파일 실패 — `SetElementOrigin` 없음

- [ ] **Step 3: `FeModelContext` 에 사이드맵을 추가한다**

`FeModelContext.cs` 의 `_traces` 필드 근처에 필드를, `AddTrace(TraceRecord record)` 아래에 메서드를 넣는다.

```csharp
    private readonly Dictionary<int, ElementOrigin> _elementOrigins = new();

    /// <summary>
    /// 부재 출신 사이드맵. Element 는 불변 객체라 필드를 붙일 수 없어 모델이 따로 들고 간다.
    /// ModelDiffTracer 가 신규 요소마다 채우고, ModelEvidenceWriter 가 읽는다.
    /// </summary>
    public IReadOnlyDictionary<int, ElementOrigin> ElementOrigins => _elementOrigins;

    /// <summary>부재 출신을 기록한다. 같은 id 를 다시 쓰면 덮어쓴다(재분할 시 최신 경로가 맞다).</summary>
    public void SetElementOrigin(int elementId, ElementOrigin origin) => _elementOrigins[elementId] = origin;

    /// <summary>출신이 없으면 null. 부모에서 상속할 때 쓴다.</summary>
    public ElementOrigin? TryGetElementOrigin(int elementId)
        => _elementOrigins.TryGetValue(elementId, out var o) ? o : null;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter ElementOriginTests`
Expected: PASS (2 tests)

**커밋 대상:** `FeModelContext.cs`, `ElementOriginTests.cs`

---

### Task 3: 초기 출신 심기 — `CaseLoader.AbsorbRawTrace`

CSV 행에서 만들어진 초기 요소에 `Derived` 출신을 심는다. 이게 없으면 상속할 뿌리가 없다.

**Files:**
- Modify: `src/MooringFitting.App/Commands/CaseLoader.cs:89-105`
- Test: `src/MooringFitting.Tests/ElementOriginTests.cs` (추가)

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`ElementOriginTests.cs` 에 아래 테스트를 추가한다.

```csharp
        [Fact]
        public void AbsorbRawTrace_SeedsDerivedOrigin_ForEachRawRow()
        {
            var model = FeModelContext.CreateEmpty();
            var rawTrace = new List<MooringFitting.Traceability.RawToFeRecord>
            {
                new() { RawKind = "Angle", RawLineNumber = 198, RawId = "HSTIFF", ElementId = 7, PropertyId = 3, NodeIds = new[] { 1, 2 } },
                new() { RawKind = "Mf",    RawLineNumber = 12,  RawId = "MF-F19", ElementId = -1 },   // MF 는 요소를 안 만든다
            };

            MooringFitting.App.Commands.CaseLoader.AbsorbRawTraceForTest(model, rawTrace);

            Assert.Equal(OriginKind.Derived, model.ElementOrigins[7].Kind);
            Assert.Equal("Angle", model.ElementOrigins[7].RawKind);
            Assert.Equal(198, model.ElementOrigins[7].RawLineNumber);
            Assert.False(model.ElementOrigins.ContainsKey(-1));   // ElementId=-1 은 심지 않는다
        }
```

`using System.Collections.Generic;` 를 파일 상단에 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter AbsorbRawTrace`
Expected: 컴파일 실패 — `AbsorbRawTraceForTest` 없음

- [ ] **Step 3: `CaseLoader.AbsorbRawTrace` 에 출신 심기를 추가하고 테스트 훅을 연다**

`CaseLoader.cs` 의 `AbsorbRawTrace` 안, `model.AddTrace(...)` 호출 **바로 뒤**에 아래를 넣는다.

```csharp
                // 진단의 뿌리 — 이 요소가 어느 CSV 행에서 왔는지. 분할 자식은 여기서부터 상속한다.
                if (rec.ElementId != -1)
                {
                    model.SetElementOrigin(rec.ElementId, new ElementOrigin(
                        OriginKind.Derived,
                        RawKind: rec.RawKind,
                        RawLineNumber: rec.RawLineNumber,
                        RawId: rec.RawId,
                        Chain: new List<string> { "00_BuildRaw" }));
                }
```

`AbsorbRawTrace` 는 `private` 이므로 테스트용 훅을 같은 클래스에 추가한다.

```csharp
        /// <summary>테스트 전용 진입점 — AbsorbRawTrace 는 private 이라 직접 호출할 수 없다.</summary>
        internal static void AbsorbRawTraceForTest(FeModelContext model, IReadOnlyList<RawToFeRecord> rawTrace)
            => AbsorbRawTrace(model, rawTrace);
```

`MooringFitting.App.csproj` 에 아래를 추가해 테스트 어셈블리에 `internal` 을 공개한다(이미 있으면 생략).

```xml
  <ItemGroup>
    <AssemblyAttribute Include="System.Runtime.CompilerServices.InternalsVisibleToAttribute">
      <_Parameter1>MooringFitting.Tests</_Parameter1>
    </AssemblyAttribute>
  </ItemGroup>
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter ElementOriginTests`
Expected: PASS (3 tests)

**커밋 대상:** `CaseLoader.cs`, `MooringFitting.App.csproj`, `ElementOriginTests.cs`

---

### Task 4: `ModelDiffTracer` 기하 매칭

신규 요소가 이전 요소의 선분 안에 들어가면 그 출신을 상속하고, 아니면 `Fabricated` 로 표시한다. modifier 10곳의 호출부(`new ModelDiffTracer(ctx, Name)`)는 **바뀌지 않는다.**

**Files:**
- Modify: `src/MooringFitting.Pipeline/Core/ModelDiffTracer.cs`
- Test: `src/MooringFitting.Tests/ModelDiffTracerOriginTests.cs`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```csharp
using System.Collections.Generic;
using MooringFitting.Model;
using MooringFitting.Model.Entities;
using MooringFitting.Pipeline.Core;
using Xunit;

namespace MooringFitting.Tests
{
    /// <summary>
    /// 진단 문장의 신뢰도가 이 두 판정에 걸려 있다.
    ///  - 분할 자식을 부모로 못 잇으면 "어느 CSV 행"을 말할 수 없다.
    ///  - 연장 스텁을 부모에 이으면 원 도면에 없는 부재를 "CSV N행 때문"이라고 거짓 설명한다.
    /// </summary>
    public class ModelDiffTracerOriginTests
    {
        /// <summary>(0,0,0)-(1000,0,0) 요소 1개를 가진 모델. 요소 id=1, 노드 1·2.</summary>
        private static FeModelContext ModelWithOneBeam()
        {
            var model = FeModelContext.CreateEmpty();
            model.Nodes.AddWithID(1, 0, 0, 0);
            model.Nodes.AddWithID(2, 1000, 0, 0);
            model.Elements.AddWithID(1, new[] { 1, 2 }, 1);
            model.SetElementOrigin(1, new ElementOrigin(
                OriginKind.Derived, RawKind: "Angle", RawLineNumber: 198, RawId: "HSTIFF",
                Chain: new List<string> { "00_BuildRaw" }));
            return model;
        }

        private static StageContext MakeCtx(FeModelContext model, string stageName)
            => StageContext.CreateForTest(model, stageName);

        [Fact]
        public void SplitChild_InheritsParentOrigin()
        {
            var model = ModelWithOneBeam();
            var ctx = MakeCtx(model, "02_ElementSplit");
            var tracer = new ModelDiffTracer(ctx, "SplitByExistingNodes");

            // 부모를 지우고 (0..400), (400..1000) 두 자식으로 쪼갠다
            model.Nodes.AddWithID(3, 400, 0, 0);
            model.Elements.Remove(1);
            model.Elements.AddWithID(10, new[] { 1, 3 }, 1);
            model.Elements.AddWithID(11, new[] { 3, 2 }, 1);

            tracer.RecordDiff(ctx);

            Assert.Equal(OriginKind.Derived, model.ElementOrigins[10].Kind);
            Assert.Equal(198, model.ElementOrigins[10].RawLineNumber);
            Assert.Equal(198, model.ElementOrigins[11].RawLineNumber);
            Assert.Contains("SplitByExistingNodes", model.ElementOrigins[10].Chain![^1]);
        }

        [Fact]
        public void ExtendedStub_IsFabricated_NotInherited()
        {
            var model = ModelWithOneBeam();
            var ctx = MakeCtx(model, "04_Connectivity");
            var tracer = new ModelDiffTracer(ctx, "ExtendToBBoxIntersect");

            // 원 요소는 남고, 자유단에서 바깥으로 뻗은 스텁을 새로 만든다 (1000..1800)
            model.Nodes.AddWithID(4, 1800, 0, 0);
            model.Elements.AddWithID(20, new[] { 2, 4 }, 1);

            tracer.RecordDiff(ctx);

            Assert.Equal(OriginKind.Fabricated, model.ElementOrigins[20].Kind);
            Assert.Equal("ExtendToBBoxIntersect", model.ElementOrigins[20].Operation);
            Assert.Equal("04_Connectivity", model.ElementOrigins[20].Stage);
        }

        [Fact]
        public void OffAxisNewElement_IsFabricated()
        {
            var model = ModelWithOneBeam();
            var ctx = MakeCtx(model, "04_Connectivity");
            var tracer = new ModelDiffTracer(ctx, "NodeClusterMerge");

            // 부모 선분과 무관한 위치(수직거리 500mm > CollinearDistTolMm 20)
            model.Nodes.AddWithID(5, 0, 500, 0);
            model.Nodes.AddWithID(6, 1000, 500, 0);
            model.Elements.AddWithID(30, new[] { 5, 6 }, 1);

            tracer.RecordDiff(ctx);

            Assert.Equal(OriginKind.Fabricated, model.ElementOrigins[30].Kind);
        }
    }
}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter ModelDiffTracerOriginTests`
Expected: 컴파일 실패 — `StageContext.CreateForTest` 없음

- [ ] **Step 3: `StageContext` 에 테스트 팩토리를 추가한다**

`src/MooringFitting.Pipeline/Core/StageContext.cs` 클래스 끝에 추가한다. 기존 생성자의 필수 인자(Options/Logger/Output)를 테스트에서 채우기 번거로워 최소 구성을 제공한다.

`ILogger` 는 `Microsoft.Extensions.Logging.ILogger` 이므로 표준 `NullLogger.Instance` 를 쓴다.
`RunOptions.RecordTrace` 는 기본값이 `true` 라 따로 세울 필요가 없다.

```csharp
        /// <summary>테스트 전용 — 최소 구성의 StageContext.</summary>
        internal static StageContext CreateForTest(FeModelContext model, string stageName)
            => new StageContext(model, new RunOptions(),
                                Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance,
                                new NullStageOutput(), stageName);
```

`IStageOutput` 은 멤버가 셋이다. 아무것도 쓰지 않는 구현을 같은 파일에 추가한다.

```csharp
    /// <summary>아무것도 쓰지 않는 stage 출력 — 테스트용.</summary>
    internal sealed class NullStageOutput : IStageOutput
    {
        public void WriteJson<T>(string fileName, T payload) { }
        public void WriteBdf(string fileName, FeModelContext model) { }
        public string ResolveByproductPath(string relativeName) => relativeName;
    }
```

`MooringFitting.Pipeline.csproj` 에 `InternalsVisibleTo` 를 추가한다.

```xml
  <ItemGroup>
    <AssemblyAttribute Include="System.Runtime.CompilerServices.InternalsVisibleToAttribute">
      <_Parameter1>MooringFitting.Tests</_Parameter1>
    </AssemblyAttribute>
  </ItemGroup>
```

- [ ] **Step 4: `ModelDiffTracer` 를 고친다**

`ModelDiffTracer.cs` 전체를 아래로 교체한다.

```csharp
using System;
using System.Collections.Generic;
using MooringFitting.Model;
using MooringFitting.Model.Entities;
using MooringFitting.Model.Geometry;

namespace MooringFitting.Pipeline.Core
{
    /// <summary>
    /// Modifier 실행 전후의 Element/Node ID set diff를 trace로 기록하는 헬퍼.
    ///
    /// 부모-자식 추정: 사전 스냅샷에 좌표까지 담아, 신규 요소가 이전 요소의 선분 안에
    /// 들어가면 그 출신을 상속시킨다(분할 자식). 들어가지 않으면 Fabricated 로 남긴다
    /// (자유단 연장·collapse 처럼 원 도면에 대응 행이 없는 부재). 후자에 억지로 부모를
    /// 붙이면 진단이 "CSV N행 때문"이라는 거짓 설명을 내놓게 되므로 반드시 구분한다.
    ///
    /// 허용오차는 기존 Tolerances.Geom 을 그대로 쓴다 — 분할·정렬 modifier 가 쓰는 바로
    /// 그 값이라, 같은 tol 로 되짚어야 그들이 만든 자식을 빠짐없이 인식한다.
    /// </summary>
    public sealed class ModelDiffTracer
    {
        private readonly HashSet<int> _preElements;
        private readonly HashSet<int> _preNodes;
        private readonly string _subStageName;

        /// <summary>사전 스냅샷의 요소 선분 — 부모 추정용. (id, 시작점, 끝점)</summary>
        private readonly List<(int Id, Point3D A, Point3D B)> _preSegments = new();

        public ModelDiffTracer(StageContext ctx, string subStageName)
        {
            _subStageName = subStageName;
            _preElements = new HashSet<int>();
            foreach (var kv in ctx.Model.Elements) _preElements.Add(kv.Key);
            _preNodes = new HashSet<int>();
            foreach (var kv in ctx.Model.Nodes) _preNodes.Add(kv.Key);

            foreach (var kv in ctx.Model.Elements)
            {
                var nids = kv.Value.NodeIDs;
                if (nids == null || nids.Count < 2) continue;
                if (!ctx.Model.Nodes.Contains(nids[0]) || !ctx.Model.Nodes.Contains(nids[1])) continue;
                _preSegments.Add((kv.Key,
                    ctx.Model.Nodes.GetNodeCoordinates(nids[0]),
                    ctx.Model.Nodes.GetNodeCoordinates(nids[1])));
            }
        }

        /// <summary>현재 모델 상태와 snapshot 비교해 diff trace 발행 + 출신 전파.</summary>
        public void RecordDiff(StageContext ctx)
        {
            var postElements = new HashSet<int>();
            foreach (var kv in ctx.Model.Elements) postElements.Add(kv.Key);
            var postNodes = new HashSet<int>();
            foreach (var kv in ctx.Model.Nodes) postNodes.Add(kv.Key);

            foreach (var id in _preElements)
                if (!postElements.Contains(id))
                    ctx.AddTrace(TraceAction.ElementRemoved, elementId: id, note: $"By {_subStageName}");

            foreach (var id in postElements)
            {
                if (_preElements.Contains(id)) continue;

                int parentId = FindParent(ctx, id);
                ctx.AddTrace(TraceAction.ElementCreated, elementId: id,
                             relatedElementId: parentId > 0 ? parentId : (int?)null,
                             note: $"By {_subStageName}");
                PropagateOrigin(ctx, id, parentId);
            }

            foreach (var id in _preNodes)
                if (!postNodes.Contains(id))
                    ctx.AddTrace(TraceAction.NodeMerged, nodeId: id, note: $"By {_subStageName} (removed)");

            foreach (var id in postNodes)
                if (!_preNodes.Contains(id))
                    ctx.AddTrace(TraceAction.NodeCreated, nodeId: id, note: $"By {_subStageName}");
        }

        /// <summary>부모 후보 중 선분 포함 조건을 만족하는 것을 찾는다. 없으면 -1.</summary>
        private int FindParent(StageContext ctx, int newId)
        {
            var nids = ctx.Model.Elements[newId].NodeIDs;
            if (nids == null || nids.Count < 2) return -1;
            if (!ctx.Model.Nodes.Contains(nids[0]) || !ctx.Model.Nodes.Contains(nids[1])) return -1;

            var a = ctx.Model.Nodes.GetNodeCoordinates(nids[0]);
            var b = ctx.Model.Nodes.GetNodeCoordinates(nids[1]);
            var tol = ctx.Options.Tolerances.Geom;

            int best = -1;
            double bestDist = double.MaxValue;
            foreach (var seg in _preSegments)
            {
                double da = PointToSegmentDistance(a, seg.A, seg.B);
                double db = PointToSegmentDistance(b, seg.A, seg.B);
                if (da > tol.CollinearDistTolMm || db > tol.CollinearDistTolMm) continue;

                double d = da + db;
                if (d < bestDist) { bestDist = d; best = seg.Id; }
            }
            return best;
        }

        /// <summary>부모가 있으면 출신 상속, 없으면 Fabricated 로 기록.</summary>
        private void PropagateOrigin(StageContext ctx, int newId, int parentId)
        {
            var parent = parentId > 0 ? ctx.Model.TryGetElementOrigin(parentId) : null;
            if (parent != null)
            {
                ctx.Model.SetElementOrigin(newId, parent.WithStep($"{ctx.StageName}/{_subStageName}"));
                return;
            }

            ctx.Model.SetElementOrigin(newId, new ElementOrigin(
                OriginKind.Fabricated,
                Stage: ctx.StageName,
                Operation: _subStageName,
                Chain: new List<string> { $"{ctx.StageName}/{_subStageName}" }));
        }

        /// <summary>점 p 와 선분 ab 사이의 최단거리(mm).</summary>
        internal static double PointToSegmentDistance(Point3D p, Point3D a, Point3D b)
        {
            double abx = b.X - a.X, aby = b.Y - a.Y, abz = b.Z - a.Z;
            double apx = p.X - a.X, apy = p.Y - a.Y, apz = p.Z - a.Z;
            double ab2 = abx * abx + aby * aby + abz * abz;
            if (ab2 < 1e-12) return Math.Sqrt(apx * apx + apy * apy + apz * apz);

            double t = (apx * abx + apy * aby + apz * abz) / ab2;
            if (t < 0) t = 0; else if (t > 1) t = 1;

            double cx = a.X + abx * t - p.X;
            double cy = a.Y + aby * t - p.Y;
            double cz = a.Z + abz * t - p.Z;
            return Math.Sqrt(cx * cx + cy * cy + cz * cz);
        }
    }
}
```

> **주의:** `ExtendedStub_IsFabricated_NotInherited` 테스트가 통과하려면 스텁의 두 끝점 중
> 바깥 끝(1800,0,0)이 부모 선분(0..1000)에서 800mm 떨어져 `CollinearDistTolMm`(20)을 넘어야 한다.
> 위 구현은 **양 끝점 모두** 부모 선분 위에 있을 것을 요구하므로 스텁은 걸러진다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter ModelDiffTracerOriginTests`
Expected: PASS (3 tests)

- [ ] **Step 6: 전체 테스트 회귀 확인**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj`
Expected: 기존 15개 + 신규 6개 = 21 PASS

**커밋 대상:** `ModelDiffTracer.cs`, `StageContext.cs`, `MooringFitting.Pipeline.csproj`, `ModelDiffTracerOriginTests.cs`

---

### Task 5: MeshRefinement 출신 상속

MeshRefinement 는 `ModelDiffTracer` 를 쓰지 않고 `TraceAction.ElementSplit` 을 직접 발행한다(부모+derivatives). 여기서도 출신을 상속시킨다.

**Files:**
- Modify: `src/MooringFitting.Pipeline/Phases/MeshRefinement/MeshRefinementModifier.cs:102`
- Test: `src/MooringFitting.Tests/ModelDiffTracerOriginTests.cs` (추가)

- [ ] **Step 1: 실패하는 테스트를 추가한다**

```csharp
        [Fact]
        public void MeshRefinementChildren_InheritParentOrigin()
        {
            var model = ModelWithOneBeam();
            var ctx = MakeCtx(model, "05_MeshRefinement");

            // MeshRefinementModifier 가 하는 일과 동일한 형태로 자식을 만들고 헬퍼를 호출한다
            model.Nodes.AddWithID(7, 500, 0, 0);
            model.Elements.Remove(1);
            model.Elements.AddWithID(40, new[] { 1, 7 }, 1);
            model.Elements.AddWithID(41, new[] { 7, 2 }, 1);

            MooringFitting.Pipeline.Phases.MeshRefinement.MeshRefinementModifier
                .InheritOriginToChildren(ctx, parentId: 1, childIds: new[] { 40, 41 }, segments: 2);

            Assert.Equal(198, model.ElementOrigins[40].RawLineNumber);
            Assert.Equal(198, model.ElementOrigins[41].RawLineNumber);
            Assert.Contains("2분할", model.ElementOrigins[40].Chain![^1]);
        }
```

- [ ] **Step 2: 실패를 확인한다**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter MeshRefinementChildren`
Expected: 컴파일 실패 — `InheritOriginToChildren` 없음

- [ ] **Step 3: 헬퍼를 추가하고 호출한다**

`MeshRefinementModifier` 클래스에 추가한다.

```csharp
        /// <summary>
        /// 분할 자식에 부모 출신을 물려준다. MeshRefinement 는 ModelDiffTracer 를 쓰지 않고
        /// ElementSplit trace 를 직접 발행하므로 출신 전파도 여기서 직접 한다.
        /// </summary>
        internal static void InheritOriginToChildren(StageContext ctx, int parentId,
                                                     IReadOnlyList<int> childIds, int segments)
        {
            var parent = ctx.Model.TryGetElementOrigin(parentId);
            foreach (int childId in childIds)
            {
                ctx.Model.SetElementOrigin(childId, parent != null
                    ? parent.WithStep($"{ctx.StageName}({segments}분할)")
                    : new ElementOrigin(OriginKind.Fabricated,
                                        Stage: ctx.StageName, Operation: "MeshRefinement",
                                        Chain: new List<string> { $"{ctx.StageName}({segments}분할)" }));
            }
        }
```

`ctx.AddTrace(TraceAction.ElementSplit, ...)` 호출 **바로 뒤**에 아래 한 줄을 넣는다. 변수명은 그 자리의 실제 이름(부모 id / 자식 id 목록)에 맞춘다.

```csharp
                InheritOriginToChildren(ctx, parentId: <부모 id 변수>, childIds: <자식 id 목록 변수>, segments: <분할 수 변수>);
```

`using MooringFitting.Model;` 과 `using System.Collections.Generic;` 을 파일 상단에 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj`
Expected: 22 PASS

**커밋 대상:** `MeshRefinementModifier.cs`, `ModelDiffTracerOriginTests.cs`

---

### Task 6: `LineageJsonWriter` 역인덱스

**Files:**
- Modify: `src/MooringFitting.App/Io/Json/LineageJsonWriter.cs:47-67`

- [ ] **Step 1: `Derivatives`/`Sources` 를 인덱싱한다**

`foreach (var t in model.Traces)` 루프 안, `RelatedElementId` 처리 **바로 뒤**에 추가한다.

```csharp
                // 분할 자식(Derivatives) / 병합 원본(Sources) 도 자기 timeline 을 갖게 한다.
                // 종전에는 부모 엔트리에만 기록돼 MeshRefinement 자식 1,000여 개가
                // "이력 없음"으로 보였다(최종 요소의 83%).
                if (t.Derivatives != null)
                    foreach (int childId in t.Derivatives)
                        if (childId != t.ElementId)
                            AddTo(elementHistory, childId, BuildElementEvent(t, asRelated: true));

                if (t.Sources != null)
                    foreach (int sourceId in t.Sources)
                        if (sourceId != t.ElementId)
                            AddTo(elementHistory, sourceId, BuildElementEvent(t, asRelated: true));
```

- [ ] **Step 2: `meta` 에 출신 커버리지를 싣는다**

`payload` 의 `meta` 객체에 아래 두 필드를 추가한다. Task 8 의 커버리지 검증이 이 값을 읽는다.

```csharp
                    elementsWithOrigin = model.ElementOrigins.Count,
                    elementCount = model.Elements.Count,
```

- [ ] **Step 3: 빌드**

Run: `dotnet build MooringFitting.sln`
Expected: 0 errors

**커밋 대상:** `LineageJsonWriter.cs`

---

### Task 7: 실측 — NewCase_02 로 커버리지 확인

**Files:** 없음 (검증만)

- [ ] **Step 1: 재빌드하고 케이스를 다시 돌린다**

```bash
cd /c/Coding/WorkBenchSubModule/MooringFitting
dotnet build MooringFitting.sln -c Release
dotnet run --project src/MooringFitting.App -c Release -- build-full csv/NewCase_02
```
Expected: exit 0, `csv/NewCase_02/out/LINEAGE.json` 갱신

- [ ] **Step 2: 커버리지를 센다**

```bash
cd /c/Coding/WorkBenchSubModule/MooringFitting/csv/NewCase_02/out && python -c "
import json
L=json.load(open('LINEAGE.json',encoding='utf-8'))
ids=[int(l[8:16]) for l in open('STAGE_07_FinalValidation.bdf',encoding='utf-8',errors='ignore') if l.startswith('CBEAM')]
eh=set(int(k) for k in L['elementHistory'])
miss=[i for i in ids if i not in eh]
print('final:',len(ids),'without lineage:',len(miss))
print('meta.elementsWithOrigin:',L['meta'].get('elementsWithOrigin'),'/',L['meta'].get('elementCount'))
print('2312 history:', json.dumps(L['elementHistory'].get('2312'),ensure_ascii=False)[:300])
"
```
Expected: `without lineage: 0`, `elementsWithOrigin == elementCount`, 2312 의 timeline 이 출력됨

- [ ] **Step 3: 결과가 기대와 다르면 멈추고 보고한다**

`without lineage` 가 0이 아니면 어느 단계에서 생긴 요소가 빠졌는지(`STAGE_NN` 별 집계) 확인한 뒤 Task 4·5 로 돌아간다. **다음 Phase 로 넘어가지 않는다.**

---

## Phase B — 증거 산출 (엔진)

### Task 8: `LoadPathResolver` — 하중·SPC 로부터의 hop 수

**Files:**
- Create: `src/MooringFitting.App/Services/Analysis/LoadPathResolver.cs`
- Test: `src/MooringFitting.Tests/LoadPathResolverTests.cs`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```csharp
using System.Collections.Generic;
using MooringFitting.App.Services.Analysis;
using MooringFitting.Model.Entities;
using Xunit;

namespace MooringFitting.Tests
{
    public class LoadPathResolverTests
    {
        /// <summary>노드 1-2-3-4 를 잇는 직선 체인. 요소 1(1-2), 2(2-3), 3(3-4).</summary>
        private static FeModelContext Chain()
        {
            var m = FeModelContext.CreateEmpty();
            for (int i = 1; i <= 4; i++) m.Nodes.AddWithID(i, (i - 1) * 100, 0, 0);
            m.Elements.AddWithID(1, new[] { 1, 2 }, 1);
            m.Elements.AddWithID(2, new[] { 2, 3 }, 1);
            m.Elements.AddWithID(3, new[] { 3, 4 }, 1);
            return m;
        }

        [Fact]
        public void Hops_CountsNodeStepsFromSeed()
        {
            var m = Chain();
            var hops = LoadPathResolver.NodeHops(m, new[] { 1 });

            Assert.Equal(0, hops[1]);
            Assert.Equal(1, hops[2]);
            Assert.Equal(2, hops[3]);
            Assert.Equal(3, hops[4]);
        }

        [Fact]
        public void ElementHops_TakesMinOfBothEnds()
        {
            var m = Chain();
            var hops = LoadPathResolver.NodeHops(m, new[] { 1 });

            Assert.Equal(0, LoadPathResolver.ElementHops(m, 1, hops));   // 노드 1(0) / 2(1) → 0
            Assert.Equal(1, LoadPathResolver.ElementHops(m, 2, hops));   // 노드 2(1) / 3(2) → 1
            Assert.Equal(2, LoadPathResolver.ElementHops(m, 3, hops));
        }

        [Fact]
        public void UnreachableElement_ReturnsMinusOne()
        {
            var m = Chain();
            m.Nodes.AddWithID(9, 5000, 0, 0);
            m.Nodes.AddWithID(10, 5100, 0, 0);
            m.Elements.AddWithID(9, new[] { 9, 10 }, 1);   // 떨어진 덩어리

            var hops = LoadPathResolver.NodeHops(m, new[] { 1 });

            Assert.Equal(-1, LoadPathResolver.ElementHops(m, 9, hops));
        }
    }
}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter LoadPathResolverTests`
Expected: 컴파일 실패 — `LoadPathResolver` 없음

- [ ] **Step 3: 구현한다**

```csharp
using System.Collections.Generic;
using MooringFitting.Model.Entities;

namespace MooringFitting.App.Services.Analysis
{
  /// <summary>
  /// 하중 절점·SPC 절점에서 요소 그래프를 따라 몇 걸음 떨어져 있는지 센다.
  /// 진단에서 "하중이 이 부재에 직결된다" / "인접 절점이 SPC 다" 를 말하는 근거.
  /// 거리(mm)가 아니라 걸음 수를 쓰는 이유 — 하중이 몇 개의 부재를 거쳐 전달되는지가
  /// 응력 집중과 직접 연결되고, 부재 길이는 mesh 세분화로 임의로 바뀌기 때문이다.
  /// </summary>
  public static class LoadPathResolver
  {
    /// <summary>seed 절점들로부터의 최단 걸음 수. 도달 불가 절점은 맵에 없다.</summary>
    public static Dictionary<int, int> NodeHops(FeModelContext model, IEnumerable<int> seedNodeIds)
    {
      var adj = BuildAdjacency(model);
      var hops = new Dictionary<int, int>();
      var queue = new Queue<int>();

      foreach (int seed in seedNodeIds)
      {
        if (!model.Nodes.Contains(seed) || hops.ContainsKey(seed)) continue;
        hops[seed] = 0;
        queue.Enqueue(seed);
      }

      while (queue.Count > 0)
      {
        int cur = queue.Dequeue();
        if (!adj.TryGetValue(cur, out var neighbours)) continue;
        foreach (int next in neighbours)
        {
          if (hops.ContainsKey(next)) continue;
          hops[next] = hops[cur] + 1;
          queue.Enqueue(next);
        }
      }
      return hops;
    }

    /// <summary>요소의 두 끝 중 더 가까운 쪽의 걸음 수. 도달 불가면 -1.</summary>
    public static int ElementHops(FeModelContext model, int elementId, IReadOnlyDictionary<int, int> nodeHops)
    {
      if (!model.Elements.Contains(elementId)) return -1;
      var nids = model.Elements[elementId].NodeIDs;
      if (nids == null || nids.Count == 0) return -1;

      int best = -1;
      foreach (int nid in nids)
      {
        if (!nodeHops.TryGetValue(nid, out int h)) continue;
        if (best < 0 || h < best) best = h;
      }
      return best;
    }

    private static Dictionary<int, List<int>> BuildAdjacency(FeModelContext model)
    {
      var adj = new Dictionary<int, List<int>>();
      foreach (var kv in model.Elements)
      {
        var nids = kv.Value.NodeIDs;
        if (nids == null || nids.Count < 2) continue;
        Link(adj, nids[0], nids[1]);
        Link(adj, nids[1], nids[0]);
      }
      return adj;
    }

    private static void Link(Dictionary<int, List<int>> adj, int from, int to)
    {
      if (!adj.TryGetValue(from, out var list)) { list = new List<int>(); adj[from] = list; }
      list.Add(to);
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `dotnet test src/MooringFitting.Tests/MooringFitting.Tests.csproj --filter LoadPathResolverTests`
Expected: PASS (3 tests)

**커밋 대상:** `LoadPathResolver.cs`, `LoadPathResolverTests.cs`

---

### Task 9: `ModelEvidenceWriter`

**Files:**
- Create: `src/MooringFitting.App/Io/Json/ModelEvidenceWriter.cs`
- Modify: `src/MooringFitting.App/Commands/BuildFullCommand.cs:128` (`WriteLineageJson` 호출 뒤)

- [ ] **Step 1: 작성한다**

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using MooringFitting.App.Services.Analysis;
using MooringFitting.Model;
using MooringFitting.Model.Entities;

namespace MooringFitting.App.Io.Json
{
  /// <summary>
  /// MODEL_EVIDENCE.json — 부재별로 "왜 이런 결과가 나왔는지" 판정하는 데 필요한 사실을
  /// 미리 조인해 둔 파일. 백엔드(mooring_diagnosis.py)가 추가 조인 없이 바로 규칙을 적용한다.
  ///
  /// 왜 엔진이 조인하는가.
  ///   출신(어느 CSV 행) · 변형 이력 · 하중경로 거리는 파이프라인 메모리 안에서만 값싸게
  ///   구할 수 있다. 백엔드가 LINEAGE.json(1.2MB)과 STAGE 파일들을 되읽어 재구성하면
  ///   같은 로직이 두 벌이 되고 드리프트가 생긴다. 반대로 임계값과 문장은 자주 바뀌므로
  ///   여기에 두지 않는다 — 이 파일은 판정하지 않고 사실만 싣는다.
  /// </summary>
  public static class ModelEvidenceWriter
  {
    public const string FileName = "MODEL_EVIDENCE.json";

    private static readonly JsonSerializerOptions s_opts = new()
    {
      WriteIndented = true,
      DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
      Converters = { new JsonStringEnumConverter() },
      PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string WriteFile(FeModelContext model, string outputFolder,
                                   int substantiveSkips, int mfLoadCount, int winchLoadCount)
    {
      Directory.CreateDirectory(outputFolder);
      string path = Path.Combine(outputFolder, FileName);

      var loadNodeIds = model.ForceLoads.Select(f => f.NodeId).Distinct().ToList();
      var loadHops = LoadPathResolver.NodeHops(model, loadNodeIds);
      var spcHops = LoadPathResolver.NodeHops(model, model.SpcNodeIds);

      // 부재 → 가장 가까운 하중의 MF id. ForceLoad 에 MF id 가 없으면 노드 id 로만 답한다.
      var loadByNode = new Dictionary<int, ForceLoad>();
      foreach (var f in model.ForceLoads) loadByNode[f.NodeId] = f;

      var elements = new List<object>();
      foreach (var kv in model.Elements)
      {
        int eid = kv.Key;
        var origin = model.TryGetElementOrigin(eid);
        var nids = kv.Value.NodeIDs;

        elements.Add(new
        {
          elementId = eid,
          propertyId = kv.Value.PropertyID,
          origin = origin == null ? null : new
          {
            kind = origin.Kind.ToString().ToLowerInvariant(),
            rawKind = origin.RawKind,
            csvLine = origin.RawLineNumber,
            rawId = origin.RawId,
            stage = origin.Stage,
            operation = origin.Operation,
            chain = origin.Chain
          },
          geometry = new
          {
            n1 = nids != null && nids.Count > 0 ? nids[0] : 0,
            n2 = nids != null && nids.Count > 1 ? nids[1] : 0,
            lengthMm = Math.Round(Length(model, nids), 1)
          },
          loadPath = new
          {
            hops = LoadPathResolver.ElementHops(model, eid, loadHops)
          },
          boundary = new
          {
            spcHops = LoadPathResolver.ElementHops(model, eid, spcHops)
          }
        });
      }

      var payload = new
      {
        meta = new
        {
          schemaVersion = "1.0",
          timestamp = DateTime.UtcNow.ToString("o"),
          elementCount = model.Elements.Count,
          elementsWithOrigin = model.ElementOrigins.Count,
          fabricatedCount = model.ElementOrigins.Values.Count(o => o.Kind == OriginKind.Fabricated)
        },
        // 케이스 단위 사실 — 백엔드가 파일 하나만 읽으면 되도록 여기에 같이 싣는다.
        caseFacts = new
        {
          substantiveSkips,
          mfLoadCount,
          winchLoadCount,
          spcNodeCount = model.SpcNodeIds.Count,
          rbe2Count = model.Rbe2s.Count
        },
        elements
      };

      File.WriteAllText(path, JsonSerializer.Serialize(payload, s_opts));
      return path;
    }

    private static double Length(FeModelContext model, IReadOnlyList<int>? nids)
    {
      if (nids == null || nids.Count < 2) return 0;
      if (!model.Nodes.Contains(nids[0]) || !model.Nodes.Contains(nids[1])) return 0;
      var a = model.Nodes.GetNodeCoordinates(nids[0]);
      var b = model.Nodes.GetNodeCoordinates(nids[1]);
      double dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z;
      return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
}
```

> `ForceLoad` 의 실제 필드명(`NodeId` / `MfId` 유무)을 `src/MooringFitting.Core/Model/ForceLoad.cs` 에서
> 확인해 맞춘다. MF id 필드가 있으면 `loadPath` 에 `mfId` 를 추가한다.

- [ ] **Step 2: `BuildFullCommand` 에서 호출한다**

`WriteLineageJson(loaded.Model, outputFolder);` **바로 뒤**에 추가한다.

```csharp
            // 진단 증거 — 판정하지 않고 사실만 싣는다(판정은 백엔드 mooring_diagnosis.py).
            try
            {
                string epath = ModelEvidenceWriter.WriteFile(
                    loaded.Model, outputFolder,
                    substantiveSkips: CaseLoader.CountSubstantiveSkips(loaded),
                    mfLoadCount: loaded.Model.ForceLoads.Count,
                    winchLoadCount: loaded.WinchData?.Count ?? 0);
                Console.WriteLine($"[evidence] {ModelEvidenceWriter.FileName} -> {epath}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[evidence] write failed: {ex.GetType().Name}: {ex.Message}");
            }
```

> 증거 생성 실패가 build-full 을 죽이면 안 된다 — 기존 `ModelTransformSummaryWriter` 와 같은 방어 패턴이다.
> `loaded.WinchData` 의 실제 타입에 맞춰 개수 표현을 조정한다.

- [ ] **Step 3: 빌드하고 케이스를 돌린다**

```bash
dotnet build MooringFitting.sln -c Release
dotnet run --project src/MooringFitting.App -c Release -- build-full csv/NewCase_02
```
Expected: `[evidence] MODEL_EVIDENCE.json -> ...` 출력

- [ ] **Step 4: 산출물을 확인한다**

```bash
cd csv/NewCase_02/out && python -c "
import json
d=json.load(open('MODEL_EVIDENCE.json',encoding='utf-8'))
print('meta:',d['meta'])
print('caseFacts:',d['caseFacts'])
e=[x for x in d['elements'] if x['elementId']==2312][0]
print(json.dumps(e,ensure_ascii=False,indent=1))
"
```
Expected: `elementsWithOrigin == elementCount`, 2312 의 `origin.csvLine` 또는 `origin.kind == "fabricated"` 가 채워짐

**커밋 대상:** `ModelEvidenceWriter.cs`, `BuildFullCommand.cs`

---

### Task 10: 단면 물성을 증거에 싣는다

`SECTION_WEAK` 규칙은 약축 단면계수 비교가 필요하다.

**Files:**
- Modify: `src/MooringFitting.App/Io/Json/ModelEvidenceWriter.cs`

- [ ] **Step 1: 기존 단면 계산기를 확인한다**

Run: `grep -n "public" src/MooringFitting.Pipeline/Services/SectionProperties/BeamSectionCalculator.cs | head -20`
목적: 면적·단면2차모멘트·단면계수를 이미 계산하는 메서드가 있으면 **그것을 쓴다**(중복 구현 금지).

- [ ] **Step 2: `section` 블록을 요소 객체에 추가한다**

`elements.Add(new { ... })` 안, `geometry` 앞에 넣는다.

```csharp
          section = SectionOf(model, kv.Value.PropertyID),
```

클래스에 헬퍼를 추가한다. Step 1 에서 찾은 계산기의 실제 시그니처에 맞춘다.

```csharp
    /// <summary>
    /// 단면 식별과 약축 단면계수. 진단의 SECTION_WEAK 는 같은 단면 타입끼리
    /// 약축 단면계수 중앙값과 비교하므로, 타입 문자열과 Z 값이 함께 있어야 한다.
    /// </summary>
    private static object? SectionOf(FeModelContext model, int propertyId)
    {
      if (propertyId <= 0 || !model.Properties.Contains(propertyId)) return null;
      var p = model.Properties[propertyId];
      return new
      {
        propertyId,
        type = p.SectionType,          // "I" / "T" / "L" / "BAR" …
        name = p.Name,
        areaMm2 = Math.Round(p.Area, 1),
        zWeakMm3 = Math.Round(Math.Min(p.SectionModulusY, p.SectionModulusZ), 1)
      };
    }
```

> `Properties`/`Property` 의 실제 멤버명을 `src/MooringFitting.Core/Model/Entities/Properties.cs` 에서 확인해
> 맞춘다. 단면계수가 없고 `I1`/`I2` 와 높이만 있으면 `Z = I / c` 로 계산하되,
> **계산식은 `BeamSectionCalculator` 에 이미 있으면 그것을 호출한다.**

- [ ] **Step 3: 재생성하고 확인한다**

```bash
dotnet build MooringFitting.sln -c Release
dotnet run --project src/MooringFitting.App -c Release -- build-full csv/NewCase_02
cd csv/NewCase_02/out && python -c "
import json
d=json.load(open('MODEL_EVIDENCE.json',encoding='utf-8'))
s=[x['section'] for x in d['elements'] if x['section']][:3]
print(json.dumps(s,ensure_ascii=False,indent=1))
print('section 있는 요소:',sum(1 for x in d['elements'] if x['section']),'/',len(d['elements']))
"
```
Expected: `zWeakMm3` 가 0이 아닌 값으로 채워지고, 대부분의 요소가 section 을 가짐

**커밋 대상:** `ModelEvidenceWriter.cs`

---

### Task 11: `solve-bdf` 결과에 `propertyId` 추가

**Files:**
- Modify: `src/MooringFitting.App/Commands/SolveBdfCommand.cs:236` 부근 (`return new { id = p.Key, n1, n2, ... }`)

- [ ] **Step 1: 필드를 추가한다**

`return new { id = p.Key, n1, n2, ...` 의 `n2` 뒤에 추가한다.

```csharp
                            // 진단이 단면을 찾을 때 쓴다. 결과만으로 property 를 알 수 없으면
                            // 백엔드가 MODEL_EVIDENCE 와 조인해야 하는데, 편집 모델에서는 그 조인이 깨진다.
                            propertyId = model.Elements.Contains(p.Key) ? model.Elements[p.Key].PropertyID : 0,
```

- [ ] **Step 2: 빌드**

Run: `dotnet build MooringFitting.sln`
Expected: 0 errors

- [ ] **Step 3: 회귀 확인 — 기존 소비자가 안 깨지는지 본다**

Run: `grep -rn "\.result\.json\|nastranResultJson" /c/Coding/WorkBench/HiTessWorkBenchBackEnd/app /c/Coding/WorkBenchSubModule/MooringFittingStudio/src | head`
Expected: 필드 **추가**만 했으므로 기존 소비자는 영향 없음. 확인만 하고 지나간다.

**커밋 대상:** `SolveBdfCommand.cs`

---

## Phase C — 판정 (백엔드)

### Task 12: `mooring_diagnosis.py` — 케이스 단위 규칙

**Files:**
- Create: `app/services/mooring_diagnosis.py`
- Test: `tests/test_mooring_diagnosis.py`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
"""mooring_diagnosis 규칙 테스트 — 순수 함수라 파일 없이 dict 만으로 검증한다."""
from app.services.mooring_diagnosis import diagnose


def _evidence(**over):
    base = {
        "meta": {"elementCount": 10, "elementsWithOrigin": 10, "fabricatedCount": 0},
        "caseFacts": {"substantiveSkips": 0, "mfLoadCount": 4, "winchLoadCount": 2,
                      "spcNodeCount": 12, "rbe2Count": 2},
        "elements": [],
    }
    base["caseFacts"].update(over.pop("caseFacts", {}))
    base.update(over)
    return base


def _codes(report):
    return {f["code"] for f in report["findings"]}


def test_no_issue_produces_no_case_finding():
    report = diagnose(_evidence(), result=None, f06=None)
    assert _codes(report) == set()


def test_dropped_input_rows_are_reported():
    report = diagnose(_evidence(caseFacts={"substantiveSkips": 3}), result=None, f06=None)
    assert "INPUT_ROW_DROPPED" in _codes(report)
    finding = next(f for f in report["findings"] if f["code"] == "INPUT_ROW_DROPPED")
    assert "3" in finding["message"]          # 근거 수치가 문장에 들어간다
    assert finding["confidence"] == "확정"


def test_zero_winch_load_is_reported():
    report = diagnose(_evidence(caseFacts={"winchLoadCount": 0}), result=None, f06=None)
    assert "LOAD_NONE" in _codes(report)


def test_equilibrium_residual_over_one_percent_fails():
    report = diagnose(_evidence(), result={"equilibrium": {"maxRelResidual": 0.031}}, f06=None)
    assert "EQUILIBRIUM_FAIL" in _codes(report)


def test_solver_instability_from_f06_scan():
    report = diagnose(_evidence(), result=None, f06={"maxRatio": 2.5e8, "mechanism": False})
    assert "SOLVER_UNSTABLE" in _codes(report)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /c/Coding/WorkBench/HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v`
Expected: `ModuleNotFoundError: app.services.mooring_diagnosis`

- [ ] **Step 3: 구현한다**

```python
"""Mooring Fitting 원인 진단 — 증거를 규칙에 걸어 사용자에게 보여줄 문장을 만든다.

설계 원칙 세 가지.
  1) 근거 수치를 문장에 항상 붙인다. "굽힘 지배"가 아니라 "굽힘 92%".
     사용자가 판정을 검증할 수 있어야 판정을 믿을 수 있다.
  2) 모델 결함을 단면 부족보다 먼저 본다. 순서를 뒤집으면 "단면을 키우세요"라고
     답했는데 실은 원 도면에 없는 가짜 부재였던 경우가 생긴다 — 가장 비싼 오답이다.
  3) 아무 규칙도 맞지 않으면 지어내지 않는다.

순수 함수다. 파일 I/O·DB 를 타지 않아 규칙만 따로 테스트할 수 있다.
"""
from __future__ import annotations

# ── 임계값 (실측 후 조정. 근거는 spec §5.5) ─────────────────────────────
EQUILIBRIUM_FAIL_RATIO = 1.0e-2      # EquilibriumVerifier.RelTolFail 과 같은 값
MAXRATIO_WARN = 1.0e5                # MSC 관례 — 이 이상은 준특이 의심

CONF_CERTAIN = "확정"
CONF_LIKELY = "유력"
CONF_HINT = "참고"


def diagnose(evidence: dict, result: dict | None, f06: dict | None) -> dict:
    """증거 → 진단 보고서 dict.

    evidence: MODEL_EVIDENCE.json 파싱 결과
    result:   solve-bdf 결과 JSON (해석 전이면 None)
    f06:      F06 스캔 요약 (없으면 None)
    """
    findings: list[dict] = []
    findings.extend(_case_findings(evidence, result, f06))

    return {
        "schemaVersion": "1.0",
        "findings": findings,
        "elementFindings": [],
    }


def _case_findings(evidence: dict, result: dict | None, f06: dict | None) -> list[dict]:
    facts = evidence.get("caseFacts", {})
    out: list[dict] = []

    skips = facts.get("substantiveSkips", 0)
    if skips > 0:
        out.append(_finding(
            "INPUT_ROW_DROPPED", CONF_CERTAIN,
            f"입력 CSV {skips}행이 모델에 반영되지 않았습니다. "
            f"해당 부재는 해석 모델에 존재하지 않으므로 결과에도 나타나지 않습니다.",
            hint="CSV_Parse_Skips.csv 에서 행 번호와 사유를 확인하세요."))

    for label, key in (("MF", "mfLoadCount"), ("Winch", "winchLoadCount")):
        if facts.get(key, 0) == 0:
            out.append(_finding(
                "LOAD_NONE", CONF_CERTAIN,
                f"{label} 하중이 0건입니다. 입력 CSV 에 LOADCASE 행이 없거나 모두 빈 행입니다.",
                hint=f"Report_LoadCalculation_{label}.csv 가 헤더만 있는지 확인하세요."))

    residual = ((result or {}).get("equilibrium") or {}).get("maxRelResidual")
    if residual is not None and residual > EQUILIBRIUM_FAIL_RATIO:
        out.append(_finding(
            "EQUILIBRIUM_FAIL", CONF_CERTAIN,
            f"적용 하중과 반력이 {residual * 100:.1f}% 어긋납니다. "
            f"하중이 모델에 도달하지 못했거나 SPC·RBE2 가 하중을 흡수하고 있습니다."))

    if f06:
        max_ratio = f06.get("maxRatio")
        if f06.get("mechanism"):
            out.append(_finding(
                "SOLVER_UNSTABLE", CONF_CERTAIN,
                "강성행렬에 메커니즘(강체 운동)이 있습니다. 구속이 부족해 해를 신뢰할 수 없습니다."))
        elif max_ratio is not None and max_ratio > MAXRATIO_WARN:
            out.append(_finding(
                "SOLVER_UNSTABLE", CONF_LIKELY,
                f"강성행렬 조건수(MAXRATIO)가 {max_ratio:.1e} 입니다. "
                f"건전한 모델은 1e3 내외이며 1e5 를 넘으면 준특이를 의심합니다."))

    return out


def _finding(code: str, confidence: str, message: str, hint: str = "") -> dict:
    return {"code": code, "confidence": confidence, "message": message, "hint": hint}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v`
Expected: PASS (5 tests)

**커밋 대상:** `app/services/mooring_diagnosis.py`, `tests/test_mooring_diagnosis.py`

---

### Task 13: 부재 단위 규칙 4개 + 우선순위

**Files:**
- Modify: `app/services/mooring_diagnosis.py`
- Modify: `tests/test_mooring_diagnosis.py`

- [ ] **Step 1: 실패하는 테스트를 추가한다**

```python
def _elem(eid=2312, kind="derived", **over):
    e = {
        "elementId": eid, "propertyId": 47,
        "origin": {"kind": kind, "rawKind": "Angle", "csvLine": 198, "rawId": "HSTIFF",
                   "stage": "04_Connectivity", "operation": "ExtendToBBoxIntersect",
                   "chain": ["00_BuildRaw", "05_MeshRefinement(3분할)"]},
        "section": {"propertyId": 47, "type": "L", "name": "L150x90x12",
                    "areaMm2": 2760.0, "zWeakMm3": 41200.0},
        "geometry": {"n1": 812, "n2": 1634, "lengthMm": 490.2},
        "loadPath": {"hops": 5},
        "boundary": {"spcHops": 6},
    }
    e.update(over)
    return e


def _result(eid=2312, usage=1.697, nx=40.0, my=300.0, mz=10.0, qy=5.0):
    return {"cases": [{"subcaseId": 8, "elements": [
        {"id": eid, "propertyId": 47, "usage": usage, "ok": usage < 1.0,
         "nx": nx, "my": my, "mz": mz, "mx": 0.0, "qy": qy, "qz": 0.0}]}]}


def _elem_codes(report, eid=2312):
    return {f["code"] for f in report["elementFindings"] if f["elementId"] == eid}


def test_fabricated_element_is_named_as_fake_load_path():
    ev = _evidence(elements=[_elem(kind="fabricated")])
    report = diagnose(ev, _result(), None)
    assert "FAKE_LOAD_PATH" in _elem_codes(report)


def test_model_defect_outranks_section_weakness():
    """가짜 부재이면서 단면도 약한 경우 — 주원인은 모델 결함이어야 한다."""
    ev = _evidence(elements=[
        _elem(kind="fabricated"),
        _elem(eid=99, section={"propertyId": 1, "type": "L", "name": "big",
                               "areaMm2": 9000.0, "zWeakMm3": 400000.0}),
    ])
    report = diagnose(ev, _result(), None)
    primary = next(f for f in report["elementFindings"] if f["elementId"] == 2312 and f["primary"])
    assert primary["code"] == "FAKE_LOAD_PATH"


def test_free_end_spc_next_door_is_boundary_artifact():
    ev = _evidence(elements=[_elem(boundary={"spcHops": 1, "spcSource": "FreeEnd"})])
    report = diagnose(ev, _result(), None)
    assert "BOUNDARY_ARTIFACT" in _elem_codes(report)


def test_load_proximity_uses_hops_threshold():
    ev = _evidence(elements=[_elem(loadPath={"hops": 2})])
    report = diagnose(ev, _result(), None)
    assert "LOAD_PROXIMITY" in _elem_codes(report)


def test_section_weak_compares_against_same_type_median():
    """같은 L 타입 중앙값의 1/3 이하일 때만 발동한다."""
    peers = [_elem(eid=100 + i, section={"propertyId": i, "type": "L", "name": f"p{i}",
                                         "areaMm2": 5000.0, "zWeakMm3": 180000.0})
             for i in range(5)]
    ev = _evidence(elements=[_elem()] + peers)
    report = diagnose(ev, _result(), None)
    assert "SECTION_WEAK" in _elem_codes(report)
    f = next(x for x in report["elementFindings"] if x["code"] == "SECTION_WEAK")
    assert "41,200" in f["message"] and "180,000" in f["message"]   # 근거 수치


def test_clean_element_says_so_instead_of_inventing_a_cause():
    peers = [_elem(eid=100 + i, section={"propertyId": i, "type": "L", "name": f"p{i}",
                                         "areaMm2": 2700.0, "zWeakMm3": 42000.0})
             for i in range(5)]
    ev = _evidence(elements=[_elem()] + peers)
    report = diagnose(ev, _result(), None)
    primary = next(f for f in report["elementFindings"] if f["elementId"] == 2312 and f["primary"])
    assert primary["code"] == "NO_SPECIFIC_CAUSE"
```

- [ ] **Step 2: 실패를 확인한다**

Run: `WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v`
Expected: 신규 6개 FAIL (`elementFindings` 가 항상 빈 리스트)

- [ ] **Step 3: 구현한다**

`mooring_diagnosis.py` 상단 임계값에 추가한다.

```python
LOAD_PROXIMITY_HOPS = 2              # 이 이하면 "직결"로 본다
SECTION_WEAK_RATIO = 1.0 / 3.0       # 같은 단면 타입 중앙값 대비
BENDING_DOMINANT_RATIO = 0.6         # 굽힘 지배 판정
```

`diagnose` 의 `elementFindings` 를 실제 계산으로 바꾼다.

```python
    element_findings = _element_findings(evidence, result)

    return {
        "schemaVersion": "1.0",
        "findings": findings,
        "elementFindings": element_findings,
    }
```

아래 함수들을 파일에 추가한다.

```python
# 우선순위 — 작을수록 먼저. 모델 결함(1)이 단면 부족(4)을 이긴다.
_RULE_ORDER = {
    "FAKE_LOAD_PATH": 1,
    "BOUNDARY_ARTIFACT": 1,
    "LOAD_INPUT_ANOMALY": 2,
    "LOAD_PROXIMITY": 3,
    "SECTION_WEAK": 4,
    "NO_SPECIFIC_CAUSE": 9,
}


def _element_findings(evidence: dict, result: dict | None) -> list[dict]:
    if not result:
        return []

    by_id = {e["elementId"]: e for e in evidence.get("elements", [])}
    medians = _z_median_by_type(evidence.get("elements", []))
    out: list[dict] = []

    for case in result.get("cases", []):
        subcase = case.get("subcaseId")
        for res in case.get("elements", []):
            if res.get("ok", True):
                continue                      # 통과 부재는 진단하지 않는다
            ev = by_id.get(res["id"])
            if ev is None:
                out.append(_elem_finding(
                    res["id"], subcase, "USER_ADDED", CONF_CERTAIN,
                    "원 도면과 자동 변형 어느 쪽에도 없는 부재입니다. "
                    "Studio 에서 사용자가 추가한 보강재로 보입니다."))
                continue
            out.extend(_rules_for(ev, res, subcase, medians))

    _mark_primary(out)
    return out


def _rules_for(ev: dict, res: dict, subcase, medians: dict) -> list[dict]:
    eid = ev["elementId"]
    found: list[dict] = []
    origin = ev.get("origin") or {}

    if origin.get("kind") == "fabricated":
        found.append(_elem_finding(
            eid, subcase, "FAKE_LOAD_PATH", CONF_CERTAIN,
            f"원 도면에 없는 부재입니다. {origin.get('stage','')} 단계의 "
            f"{origin.get('operation','자동 변형')} 이 만든 구간이며, 하중이 이 경로로 흐릅니다.",
            hint="원 도면에 실제 부재가 있는지 확인하고, 없다면 CSV 입력의 연결 상태를 점검하세요."))

    boundary = ev.get("boundary") or {}
    if boundary.get("spcSource") == "FreeEnd" and (boundary.get("spcHops") or 99) <= 1:
        found.append(_elem_finding(
            eid, subcase, "BOUNDARY_ARTIFACT", CONF_CERTAIN,
            "인접 절점이 자유단 SPC 로 고정돼 있습니다. 이 SPC 는 연결 끊김을 찾기 위한 "
            "진단용이라 실제 구속이 아니며, 반력이 과도하게 집중됩니다.",
            hint="해당 위치의 부재 연결이 CSV 에서 끊겨 있는지 확인하세요."))

    hops = (ev.get("loadPath") or {}).get("hops")
    if hops is not None and 0 <= hops <= LOAD_PROXIMITY_HOPS:
        found.append(_elem_finding(
            eid, subcase, "LOAD_PROXIMITY", CONF_LIKELY,
            f"하중 작용점에서 {hops}절점 거리입니다. 하중이 거의 직접 전달됩니다."))

    section = ev.get("section") or {}
    z = section.get("zWeakMm3") or 0.0
    median = medians.get(section.get("type"))
    if z > 0 and median and z <= median * SECTION_WEAK_RATIO:
        share = _bending_share(res)
        found.append(_elem_finding(
            eid, subcase, "SECTION_WEAK", CONF_LIKELY,
            f"굽힘이 {share * 100:.0f}% 지배하는데 약축 단면계수가 {z:,.0f} mm³ 로, "
            f"같은 {section.get('type')} 타입 부재 중앙값 {median:,.0f} mm³ 의 "
            f"{z / median * 100:.0f}% 에 불과합니다.",
            hint="단면 상향 또는 스팬 축소를 검토하세요."))

    if not found:
        found.append(_elem_finding(
            eid, subcase, "NO_SPECIFIC_CAUSE", CONF_HINT,
            f"모델·하중·단면에서 특이 사항이 없습니다. Usage {res.get('usage')} 초과는 "
            f"설계 여유 부족으로 보입니다."))
    return found


def _bending_share(res: dict) -> float:
    """정응력 중 굽힘(My+Mz)이 차지하는 비율. 성분이 없으면 0."""
    nx = abs(res.get("nx") or 0.0)
    bending = abs(res.get("my") or 0.0) + abs(res.get("mz") or 0.0)
    total = nx + bending
    return bending / total if total > 1e-9 else 0.0


def _z_median_by_type(elements: list[dict]) -> dict:
    """단면 타입별 약축 단면계수 중앙값. 비교군이 3개 미만이면 판정하지 않는다."""
    buckets: dict[str, list[float]] = {}
    seen: set[int] = set()
    for e in elements:
        s = e.get("section") or {}
        pid, z, stype = s.get("propertyId"), s.get("zWeakMm3"), s.get("type")
        if not stype or not z or pid in seen:
            continue
        seen.add(pid)
        buckets.setdefault(stype, []).append(float(z))

    out = {}
    for stype, values in buckets.items():
        if len(values) < 3:
            continue
        values.sort()
        mid = len(values) // 2
        out[stype] = values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2
    return out


def _mark_primary(findings: list[dict]) -> None:
    """부재·서브케이스별로 우선순위가 가장 높은 하나에 primary=True 를 세운다."""
    best: dict[tuple, dict] = {}
    for f in findings:
        f["primary"] = False
        key = (f["elementId"], f["subcaseId"])
        cur = best.get(key)
        if cur is None or _RULE_ORDER[f["code"]] < _RULE_ORDER[cur["code"]]:
            best[key] = f
    for f in best.values():
        f["primary"] = True


def _elem_finding(element_id: int, subcase, code: str, confidence: str,
                  message: str, hint: str = "") -> dict:
    return {"elementId": element_id, "subcaseId": subcase, "code": code,
            "confidence": confidence, "message": message, "hint": hint}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v`
Expected: PASS (11 tests)

**커밋 대상:** `mooring_diagnosis.py`, `test_mooring_diagnosis.py`

---

### Task 14: 백엔드 연동 — solve 후 `DIAGNOSIS.json` 저장

**Files:**
- Modify: `app/services/mooring_fitting_service.py:377` 부근 (결과 JSON 읽는 자리)
- Test: `tests/test_mooring_diagnosis.py` (추가)

- [ ] **Step 1: 실패하는 테스트를 추가한다**

```python
import json
import os


def test_write_diagnosis_file_creates_json(tmp_path):
    from app.services.mooring_fitting_service import write_diagnosis_file

    out = tmp_path / "out"
    out.mkdir()
    (out / "MODEL_EVIDENCE.json").write_text(json.dumps(_evidence(
        caseFacts={"substantiveSkips": 2})), encoding="utf-8")

    path = write_diagnosis_file(str(out), result_json_path=None)

    assert os.path.basename(path) == "DIAGNOSIS.json"
    data = json.loads((out / "DIAGNOSIS.json").read_text(encoding="utf-8"))
    assert any(f["code"] == "INPUT_ROW_DROPPED" for f in data["findings"])


def test_write_diagnosis_file_returns_none_without_evidence(tmp_path):
    from app.services.mooring_fitting_service import write_diagnosis_file

    assert write_diagnosis_file(str(tmp_path), result_json_path=None) is None
```

- [ ] **Step 2: 실패를 확인한다**

Run: `WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v -k write_diagnosis`
Expected: `ImportError: cannot import name 'write_diagnosis_file'`

- [ ] **Step 3: 구현한다**

`mooring_fitting_service.py` 에 추가한다.

```python
def write_diagnosis_file(out_dir: str, result_json_path: str | None) -> str | None:
    """out/MODEL_EVIDENCE.json (+ 결과 JSON) 으로 진단해 out/DIAGNOSIS.json 을 쓴다.

    증거가 없으면 None 을 돌려주고 아무것도 쓰지 않는다.
    진단 실패가 해석·보고서를 막아서는 안 되므로 예외는 잡아 로그만 남긴다.
    """
    evidence_path = os.path.join(out_dir, "MODEL_EVIDENCE.json")
    if not os.path.isfile(evidence_path):
        return None

    try:
        from app.services.mooring_diagnosis import diagnose

        with open(evidence_path, "r", encoding="utf-8") as fh:
            evidence = json.load(fh)

        result = None
        if result_json_path and os.path.isfile(result_json_path):
            with open(result_json_path, "r", encoding="utf-8") as fh:
                result = json.load(fh)

        report = diagnose(evidence, result, f06=None)
        path = os.path.join(out_dir, "DIAGNOSIS.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        return path
    except Exception as exc:                      # noqa: BLE001 — 진단 실패로 해석을 막지 않는다
        logger.warning("진단 생성 실패: %s: %s", type(exc).__name__, exc)
        return None
```

`json`·`os`·`logger` 가 이미 import 돼 있는지 확인하고 없으면 추가한다.

- [ ] **Step 4: `task_solve_mooring_fitting` 에서 호출한다**

`result_data = {"nastranResultJson": result_json_path, "summary": summary}` **바로 앞**에 넣는다.

```python
        diagnosis_path = write_diagnosis_file(os.path.dirname(result_json_path), result_json_path)
```

그리고 `result_data` 에 필드를 추가한다.

```python
        result_data = {"nastranResultJson": result_json_path, "summary": summary}
        if diagnosis_path:
            result_data["diagnosisJson"] = diagnosis_path
```

- [ ] **Step 5: `collect_artifacts` 에 등록한다**

`collect_artifacts` 의 `_pick(...)` 목록에 두 줄을 추가한다(`transform_summary_json` 옆).

```python
        "model_evidence_json":  _pick("MODEL_EVIDENCE.json"),
        "diagnosis_json":       _pick("DIAGNOSIS.json"),
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `WorkBenchEnv/Scripts/python.exe -m pytest tests/test_mooring_diagnosis.py -v`
Expected: PASS (13 tests)

- [ ] **Step 7: 회귀 확인**

Run: `WorkBenchEnv/Scripts/python.exe -m pytest tests/ -q`
Expected: 신규 실패 없음 (기존 실패 2건은 이 작업과 무관 — 사전 존재)

**커밋 대상:** `mooring_fitting_service.py`, `test_mooring_diagnosis.py`

---

## Phase D — 노출

### Task 15: 보고서 진단 장

**Files:**
- Modify: `src/MooringFitting.App/Services/Reporting/MooringReportBuilder.cs`

- [ ] **Step 1: 진단 JSON 로더를 추가한다**

`MooringReportBuilder` 에 추가한다.

```csharp
    /// <summary>
    /// out/DIAGNOSIS.json 을 읽는다. 없으면 null — 진단 장을 통째로 건너뛴다.
    /// 판정은 백엔드가 하므로 엔진 단독 실행(CLI)에서는 대개 없다. 그래도 보고서는 나와야 한다.
    /// </summary>
    private DiagnosisDto? LoadDiagnosis(string outFolder)
    {
      string path = Path.Combine(outFolder, "DIAGNOSIS.json");
      if (!File.Exists(path)) return null;
      try
      {
        return JsonSerializer.Deserialize<DiagnosisDto>(File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
      }
      catch { return null; }   // 깨진 진단 때문에 보고서를 못 내는 일은 없어야 한다
    }

    private sealed class DiagnosisDto
    {
      public List<CaseFinding> Findings { get; set; } = new();
      public List<ElementFinding> ElementFindings { get; set; } = new();

      public sealed class CaseFinding
      {
        public string Code { get; set; } = "";
        public string Confidence { get; set; } = "";
        public string Message { get; set; } = "";
        public string Hint { get; set; } = "";
      }

      public sealed class ElementFinding : CaseFinding
      {
        public int ElementId { get; set; }
        public int SubcaseId { get; set; }
        public bool Primary { get; set; }
      }
    }
```

- [ ] **Step 2: 진단 장을 쓴다**

6장(결과)을 쓰는 메서드 **뒤**, 7장(결론) **앞**에서 호출되도록 아래 메서드를 추가하고 호출한다.

```csharp
    /// <summary>진단 장 — 결과를 보고 나서 원인을 읽고 결론으로 가는 순서에 맞춘다.</summary>
    private void WriteDiagnosis(string outFolder)
    {
      var d = LoadDiagnosis(outFolder);
      if (d == null || (d.Findings.Count == 0 && d.ElementFindings.Count == 0)) return;

      _s.Section("7  Diagnosis", newPage: true);
      _s.Para("자동 판정 결과입니다. 각 항목은 근거 수치를 함께 싣습니다. " +
              "확신도는 확정 / 유력 / 참고 세 단계입니다.");

      if (d.Findings.Count > 0)
      {
        _s.Section("7.1  Model and input");
        _s.Table(new ReportSheet.TableSpec
        {
          Widths = new[] { 4, 3, 20, 12 },
          Headers = new[] { "Code", "확신도", "내용", "조치" },
          Rows = d.Findings.Select(f => new[] { f.Code, f.Confidence, f.Message, f.Hint }).ToList(),
          LeftAlign = new[] { true, false, true, true },
          FontSize = 8.0,
        });
      }

      var primary = d.ElementFindings.Where(f => f.Primary).ToList();
      if (primary.Count > 0)
      {
        _s.Section("7.2  Members exceeding the allowable");
        _s.Table(new ReportSheet.TableSpec
        {
          Widths = new[] { 4, 3, 3, 20, 10 },
          Headers = new[] { "Beam", "LC", "확신도", "주원인", "조치" },
          Rows = primary.Select(f => new[]
          {
            f.ElementId.ToString(), f.SubcaseId.ToString(), f.Confidence, f.Message, f.Hint
          }).ToList(),
          LeftAlign = new[] { false, false, false, true, true },
          FontSize = 7.5,
        });
      }
    }
```

> 기존 7장(Conclusion)의 번호를 8로 밀고, 부록 번호는 그대로 둔다.
> `_s.Para` / `_s.Table` / `_s.Section` 의 실제 시그니처는 `ReportSheet.cs` 에서 확인해 맞춘다.

- [ ] **Step 3: 목차(`WriteContents`)에 항목을 추가한다**

`WriteContents` 의 `items` 리스트에서 `"7   Conclusion"` 을 아래로 바꾼다.

```csharp
        "7   Diagnosis", "8   Conclusion",
```

- [ ] **Step 4: 진단 없이도 보고서가 나오는지 확인한다**

```bash
cd /c/Coding/WorkBenchSubModule/MooringFitting
dotnet build MooringFitting.sln -c Release
dotnet run --project src/MooringFitting.App -c Release -- report csv/NewCase_02 -o csv/NewCase_02/out/_diag_off.xlsx
```
Expected: DIAGNOSIS.json 이 없으므로 진단 장 없이 정상 생성

- [ ] **Step 5: 진단이 있을 때를 확인한다**

```bash
cd /c/Coding/WorkBench/HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -c "
import json, sys
sys.path.insert(0, '.')
from app.services.mooring_diagnosis import diagnose
out = r'C:\Coding\WorkBenchSubModule\MooringFitting\csv\NewCase_02\out'
ev = json.load(open(out + r'\MODEL_EVIDENCE.json', encoding='utf-8'))
json.dump(diagnose(ev, None, None), open(out + r'\DIAGNOSIS.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('written')
"
cd /c/Coding/WorkBenchSubModule/MooringFitting
dotnet run --project src/MooringFitting.App -c Release -- report csv/NewCase_02 -o csv/NewCase_02/out/_diag_on.xlsx
```
Expected: 7장 Diagnosis 가 포함된 xlsx 생성. 두 파일 크기를 비교해 차이를 확인한다.

**커밋 대상:** `MooringReportBuilder.cs`

---

### Task 16: Studio 진단 패널

**Files:**
- Create: `src/store/useDiagnosisStore.js` (MooringFittingStudio)
- Modify: `src/components/InspectorPanel.jsx`
- Modify: `src/components/BottomReviewDock.jsx`
- Modify: `package.json` (버전 bump)

- [ ] **Step 1: 스토어를 만든다**

`C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\store\useDiagnosisStore.js`

```javascript
import { create } from 'zustand'

/**
 * DIAGNOSIS.json 을 담는 스토어.
 * 해석 전에는 파일이 없거나 elementFindings 가 비어 있다 — 그때는 케이스 진단만 보여준다.
 */
export const useDiagnosisStore = create((set, get) => ({
  findings: [],            // 케이스 단위
  elementFindings: [],     // 부재 단위
  loaded: false,

  load(json) {
    set({
      findings: json?.findings ?? [],
      elementFindings: json?.elementFindings ?? [],
      loaded: true,
    })
  },

  /** 부재 하나의 진단. 주원인이 먼저 오도록 정렬한다. */
  forElement(elementId) {
    return get().elementFindings
      .filter((f) => f.elementId === elementId)
      .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))
  },

  reset() {
    set({ findings: [], elementFindings: [], loaded: false })
  },
}))
```

> 스토어 라이브러리가 zustand 인지 `src/store/useEditStore.js` 상단에서 확인하고 맞춘다.

- [ ] **Step 2: `BdfStageData` 로딩 경로에서 DIAGNOSIS.json 을 읽는다**

`src/data/BdfStageData.js` 가 stage 파일을 읽는 자리와 같은 방식으로 `DIAGNOSIS.json` 을 읽어
`useDiagnosisStore.getState().load(json)` 을 호출한다. 파일이 없으면 조용히 넘어간다(해석 전 정상 상태).

- [ ] **Step 3: `InspectorPanel` 에 진단 섹션을 추가한다**

선택된 부재 정보를 그리는 자리 아래에 넣는다.

```jsx
{(() => {
  const items = useDiagnosisStore.getState().forElement(selectedElementId)
  if (!items.length) return null
  return (
    <div className="mt-3 border-t border-slate-700 pt-2">
      <div className="text-[11px] font-semibold text-slate-300 mb-1">진단</div>
      {items.map((f, i) => (
        <div key={i} className="mb-2">
          <div className="flex items-center gap-1">
            {f.primary && <span className="text-[10px] px-1 rounded bg-amber-500/20 text-amber-300">주원인</span>}
            <span className="text-[10px] text-slate-400">{f.confidence}</span>
          </div>
          <div className="text-[11px] text-slate-200 leading-snug">{f.message}</div>
          {f.hint && <div className="text-[10px] text-slate-400 leading-snug">{f.hint}</div>}
        </div>
      ))}
    </div>
  )
})()}
```

> 클래스명·색상은 주변 코드의 기존 스타일을 따른다. 위는 구조 예시다.

- [ ] **Step 4: `BottomReviewDock` 에 케이스 진단 목록을 추가한다**

기존 탭 구조에 '진단' 탭을 추가하고 `useDiagnosisStore` 의 `findings` 를 표로 그린다.
컬럼: 확신도 / 내용 / 조치.

- [ ] **Step 5: 빌드 확인**

```bash
cd /c/Coding/WorkBenchSubModule/MooringFittingStudio && npm run build
```
Expected: 빌드 성공

- [ ] **Step 6: 버전 bump 후 배포**

`package.json` 의 버전을 올린다. 현재 배포본 최고 버전을 **먼저 확인**한다.

```bash
ls "//storage.hpc.hd.com/a476854/00_PROJECT/AA_300_CF44/[개인 자료]/권혁민 책임연구원/HiTessWorkBench/StudioProgram" | grep mooring
ls /c/Coding/WorkBench/HiTessWorkBenchBackEnd/StudioProgram | grep mooring
```

빌드한 zip + sha256 을 **두 곳 모두**에 복사한다(백엔드-로컬이 우선 스캔되므로 빠뜨리면 앱이 새 버전을 못 본다).

```powershell
Copy-Item -LiteralPath '<zip>' -Destination '\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram' -Force
```

**커밋 대상:** MooringFittingStudio 는 git 미추적 — 커밋 대상 없음. 배포만 한다.

---

### Task 17: WorkBench 진단 배너

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MooringFittingAssessment.jsx`

- [ ] **Step 1: 진단 요약을 읽는다**

해석 결과를 표시하는 영역에서 `result_info.diagnosisJson` 경로를 `GET /api/download?filepath=...` 로 받아 파싱한다.
기존 결과 파일 회수 패턴을 그대로 따른다.

- [ ] **Step 2: 배너를 그린다**

CSV 파싱 결과 카드 옆에 넣는다.

```jsx
{diagnosis && diagnosis.findings.length > 0 && (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
    <div className="flex items-center gap-2 mb-2">
      <AlertTriangle size={14} className="text-amber-600" />
      <span className="text-sm font-semibold text-amber-800">
        진단 {diagnosis.findings.length}건
      </span>
    </div>
    <ul className="space-y-1">
      {diagnosis.findings.map((f, i) => (
        <li key={i} className="text-xs text-amber-900 leading-snug">
          <span className="font-mono text-[10px] text-amber-700 mr-1">{f.confidence}</span>
          {f.message}
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: 빌드 확인**

```bash
cd /c/Coding/WorkBench/HiTessWorkBench/frontend && npm run build
```
Expected: 빌드 성공

**커밋 대상:** `MooringFittingAssessment.jsx`
**⚠ 주의:** `src/config.js` 는 절대 스테이징하지 않는다(로컬 전용 백엔드 토글).

---

### Task 18: 인수 확인 — 끝까지 추적되는가

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 파이프라인을 처음부터 돌린다**

```bash
cd /c/Coding/WorkBenchSubModule/MooringFitting
dotnet run --project src/MooringFitting.App -c Release -- build-full csv/NewCase_02 --solve
```

- [ ] **Step 2: 최악 부재를 CSV 행까지 되짚는다**

```bash
cd csv/NewCase_02/out && python -c "
import json
d=json.load(open('MODEL_EVIDENCE.json',encoding='utf-8'))
e={x['elementId']:x for x in d['elements']}[2312]
o=e['origin']
print('origin kind :',o['kind'])
print('csv line    :',o.get('csvLine'), o.get('rawKind'), o.get('rawId'))
print('chain       :',' -> '.join(o.get('chain') or []))
print('load hops   :',e['loadPath']['hops'])
print('spc hops    :',e['boundary']['spcHops'])
print('section     :',e['section'])
"
```
Expected: `origin kind` 가 `derived`(csvLine 채워짐) 또는 `fabricated`(stage/operation 채워짐).
**둘 중 하나는 반드시 나와야 한다** — 이것이 이 기능의 인수 조건이다. 세션 시작 시점에는 `null` 이었다.

- [ ] **Step 3: 진단 문장을 확인한다**

```bash
cd /c/Coding/WorkBench/HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -c "
import json, sys
sys.path.insert(0, '.')
from app.services.mooring_diagnosis import diagnose
out = r'C:\Coding\WorkBenchSubModule\MooringFitting\csv\NewCase_02\out'
ev = json.load(open(out + r'\MODEL_EVIDENCE.json', encoding='utf-8'))
try:
    res = json.load(open(out + r'\STAGE_07_FinalValidation.result.json', encoding='utf-8'))
except FileNotFoundError:
    res = None
r = diagnose(ev, res, None)
for f in r['findings']:
    print('[case]', f['confidence'], f['message'])
for f in r['elementFindings'][:10]:
    if f['primary']:
        print('[elem]', f['elementId'], 'LC', f['subcaseId'], f['confidence'], f['message'])
"
```
Expected: 케이스 진단에 `LOAD_NONE`(Winch 0건)이 나오고, Fail 부재마다 주원인 문장이 하나씩 나온다.

- [ ] **Step 4: 결과가 이상하면 규칙을 조정한다**

문장이 명백히 틀렸으면(예: 정상 부재를 `SECTION_WEAK` 로 지목) `mooring_diagnosis.py` 의 임계값을 조정하고
해당 테스트를 갱신한다. **엔진 재빌드는 필요 없다** — 이 구조를 고른 이유다.

---

## 배포 (사용자 확인 후)

| 대상 | 방법 |
|---|---|
| `MooringFitting.exe` | `dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true` → `HiTessWorkBenchBackEnd/InHouseProgram/MooringFitting/MooringFitting.exe` 로 복사. **서버(145) 수동 복사 + 백엔드 재시작 필요** (git 미추적) |
| 백엔드 | `git pull` + 재시작. 이후 **규칙 수정은 이것만으로 반영된다** |
| Studio zip | 버전 bump → StudioProgram **2곳**(백엔드-로컬 + UNC) |
| WorkBench 프론트 | 재배포 |

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | Task |
|---|---|
| §4.1 LineageJsonWriter 역인덱스 | 6 |
| §4.2 ModelDiffTracer 기하 매칭 | 4 (+ MeshRefinement 경로 5) |
| §4.3 MODEL_EVIDENCE.json | 9, 10 |
| §4.4 solve-bdf propertyId | 11 |
| §4.5 report 진단 장 | 15 |
| §5.1 케이스 단위 규칙 7종 | 12 (`EFFWIDTH_INCONSISTENT`·`MODEL_DISCONNECTED`·`TRANSFORM_HEAVY` 는 아래 참고) |
| §5.2 부재 단위 규칙 4종 + 우선순위 | 13 |
| §5.3 근거 수치·확신도·fallback | 12, 13 |
| §5.4 대상 범위 | 13 (`ok=True` 는 건너뜀) |
| §6 노출 3곳 | 15, 16, 17 |
| §7 테스트 | 각 Task + 7, 18 |

**의도적으로 미룬 항목** — `EFFWIDTH_INCONSISTENT` / `MODEL_DISCONNECTED` / `TRANSFORM_HEAVY` 세 규칙은
Task 12 에 넣지 않았다. 세 값 모두 `MODEL_EVIDENCE.json` 의 `caseFacts` 에 아직 없기 때문이다.
**Task 9 Step 1 에서 `caseFacts` 에 아래 세 필드를 함께 넣고, Task 12 에서 규칙 3개를 추가한다.**

```csharp
          effWidthDeviationMm,      // EffectiveWidthResolver 가 관측한 최대 편차
          connectedComponentCount,  // FinalValidation 의 연결 성분 수
          loadPathAffectingOps,     // MODEL_TRANSFORM_SUMMARY 의 하중경로 변경 연산 합
```

세 값의 출처는 각각 `EffectiveWidthResolver`, `FinalValidationInspector`, `ModelTransformSummaryWriter` 다.
이미 계산돼 있으므로 **다시 계산하지 말고 그 값을 실어 나른다.**

**타입 일관성 확인** — `ElementOrigin.Kind` 는 C# 에서 `OriginKind` enum, JSON 에서 소문자 문자열
(`"derived"`/`"fabricated"`), Python 에서 `origin.get("kind") == "fabricated"` 로 비교한다.
Task 9 의 `.ToString().ToLowerInvariant()` 가 이 대응을 만든다.
`elementFindings` 의 키는 `elementId`/`subcaseId`/`code`/`confidence`/`message`/`hint`/`primary` 로
Task 13·15·16 에서 동일하게 쓴다.

---

## 구현 완료 기록 (2026-09-03)

전 Task 완료. 테스트 — 엔진 26/26, 백엔드 진단 39 + 서비스 2 통과.
백엔드 전체 스위트의 실패 2건(`test_drawing_image_lug_fixtures`, `test_mooring_edit_bdf`)은
`nastran_bridge` 편집 로직·도면 픽스처로 이번 변경과 무관한 **사전 실패**다.

### 인수 조건 달성

세션 시작 시점에 `null` 을 반환하던 조회가 이제 끝까지 이어진다.

```
beam 2312 (Usage 1.697, 최악)
  출신     : derived | CSV 196행 PLATE FOR-Y3745_2 (Winch 하부)
  변환경로 : 00_BuildRaw -> 02_ElementSplit/SplitByExistingNodes -> 05_MeshRefinement(2분할)
  하중거리 : 1 절점    경계: 10 절점 FreeEnd
  단면     : I  A=17,400 mm2  Iyy=3.525e8 mm4
```

추적 커버리지 **1,748 / 1,748 (100%)**. 이력 없는 요소 1,446 → 0.

### 계획에 없었으나 추가한 것 (모두 없으면 진단이 틀리거나 침묵함)

| 발견 | 조치 |
|---|---|
| MF 하중이 RBE2 전용 절점에 실려 요소 그래프만으로는 **전 부재 `hops=-1`** | `LoadPathResolver` 인접 그래프에 RBE2 간선 포함 |
| `mfLoadCount` 가 실제로는 MF+Winch 합 (이름이 사실과 다름) | `mfInputCount` / `winchInputCount` / `forceLoadCount` 로 분리 |
| 평형 검증 결과가 콘솔에만 출력되고, 실패 시 결과 JSON 자체가 생성되지 않음 | 결과와 독립된 `EQUILIBRIUM.json` 신설 |
| SPC 출처가 증거에 없어 자유단 SPC 판정 불가 (실측 82개 **전부** FreeEnd) | trace 에서 출처별로 묶어 `boundary.spcSource` 추가 |
| Studio viewer-zip 이 화이트리스트라 진단 파일이 전달되지 않음 | `diagnosis.json` 동봉 |
| 진단이 solve 후에만 생성되는데 Studio 는 build-full 직후에 열림 | build-full 종료 시점에도 생성 (결과 진단은 solve 후 갱신) |
| `LineageJsonWriter` 커버리지 지표가 분모를 초과 (삭제된 요소 출신이 맵에 잔류) | 살아 있는 요소 기준으로 집계 |

### 스펙과 달라진 점

- `ForceLoad` 에 MF id 가 없어(절점·하중케이스·벡터뿐) 증거에서 `mfId` 제외.
- `Property` 에 단면계수가 없어 검증된 `SectionGeometryCalculator` 의 **약축 Iyy** 로 비교.
  단면계수 Z 는 c 를 새로 유도해야 해 오류 여지가 크다.
- `SECTION_WEAK` 에 굽힘 지배율 60% 게이트 추가 — 축력 지배 부재에 약축 부족을 지적하면 무의미하다.

### 배포 상태

| 대상 | dev(70) | 서버(145) |
|---|---|---|
| `MooringFitting.exe` | ✅ `InHouseProgram/MooringFitting/` (79,469,908 B) | **수동 복사 + 백엔드 재시작 필요** |
| 백엔드 `mooring_diagnosis.py` 외 | ✅ 작업 트리 | **`git pull` + 재시작** (커밋 미실행) |
| Studio zip `0.1.64` | ✅ 백엔드-로컬 + UNC | **서버 `StudioProgram/` 수동 복사** |
| WorkBench 프론트 | ✅ 빌드 통과 | **재배포** |
