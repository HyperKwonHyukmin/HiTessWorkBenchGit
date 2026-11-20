/// <summary>
/// PSA 평가보고서 자동화 프로그램 — 입력 화면과 보고서 만들기.
/// 입력 단계와 Line 별 결과 엑셀 올리기(엑셀 하나 = Line 하나, 2026-11-19 — 프로젝트 폴더 통째 올리기는 폐기).
/// [보고서 만들기] = 입력 저장 → POST /report → docx 내려받기. 결정 = docs/plans/2026-11-17-psa-report-automation-plan.md
/// </summary>
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Wrench, ListTree, Thermometer, MoveVertical, Gauge, Boxes, Save, FolderInput,
  RotateCcw, FileText, ChevronLeft, ChevronRight, FileSpreadsheet, FileCheck2, AlertCircle, ClipboardList, FileImage, SearchCheck, FileDown,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import PageBanner from '../../components/ui/PageBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import StepRail from '../../components/analysis/runFrame/StepRail';
import AppUsageStatsButton from '../../components/analysis/AppUsageStatsButton';
import {
  ScopeTable, ProcessTable, DisplacementTable, AccelPositionTable, AccelLoadTable, ManifoldTable, ExcelPickButton, ExcelDropZone,
} from '../../components/analysis/psaReport/PsaInputTables';
import {
  createBlankInput, addLine, addCompRmLine, moveLine, removeLine, manifoldRowsUsingLine,
  removePosition, loadsUsingPosition, stepSummary, reportProblems, reviewBlocks, pendingChoices, serializeInput, parseInputFile,
  summarizePickedFolder, newUid, reconcileFolders, FIGURE_TARGET,
  planExcelFiles, applyExcelPlan, uniqueServerFolder, isExcelFile,
  checklistSummary, applyChecklistSelections, chooseChecklistFile, checklistBusy, folderReady,
  docInfoSummary, defaultDocInfo,
} from '../../utils/psaReport';
import {
  createPsaWorkspace, describePsaWorkspace, uploadPsaFolder, removePsaFolder, psaUploadErrorMessage, savePsaInput,
  getPsaChecklist, generatePsaReport, getPsaFigures, getPsaReview,
} from '../../api/psaReport';
import PsaChecklist from '../../components/analysis/psaReport/PsaChecklist';
import PsaDocInfo from '../../components/analysis/psaReport/PsaDocInfo';
import PsaFigures from '../../components/analysis/psaReport/PsaFigures';
import PsaBusyOverlay from '../../components/analysis/psaReport/PsaBusyOverlay';
import PsaReviewPanel, { ReviewColorKey } from '../../components/analysis/psaReport/PsaReviewPanel';

export const PSA_REPORT_APP = 'PSA 평가보고서 자동화 프로그램';
const FIGURE_KEY = '__figures__';

const STEPS = [
  { id: 'scope', title: 'Scope of Piping Lines', icon: ListTree, desc: 'CAESAR II 결과 엑셀을 고르면 엑셀 하나가 Line 하나가 됩니다. Line No. 와 Pipe Line 은 파일 이름에서 정하고, 표에서 고칠 수 있습니다. 보고서 Table 1.1 이 됩니다.' },
  { id: 'files', title: '보고서 파일 확인', icon: FileCheck2, desc: 'Line 엑셀에서 Restraint 와 응력 요약 시트를 찾았는지 Line 마다 한 줄로 봅니다. 빠진 시트는 [보고서 만들기] 때 승인받고 그 자리를 자료 없음으로 적습니다.' },
  { id: 'process', title: 'Process Condition', icon: Thermometer, desc: 'Scope 의 Line 이 그대로 줄이 됩니다. 칸에는 숫자만 넣고 단위는 머리글에 고정입니다. Enter 로 아랫칸, 범위나 두 값은 칸의 + 로 더합니다. 보고서 Table 2.3 이 됩니다.' },
  { id: 'displacement', title: 'Displacement', icon: MoveVertical, desc: '선체 변위를 mm/m 단위 실수로 넣습니다. 음수도 됩니다.' },
  { id: 'accel', title: 'Acceleration', icon: Gauge, desc: '위치(Position)를 먼저 정하고, 하중 줄마다 그 위치를 골라 가속도(g)를 넣습니다.' },
  { id: 'manifold', title: 'Manifold Load', icon: Boxes, desc: 'System(Line)과 Pipe size 를 고르면 표준 허용 하중이 채워집니다.' },
  { id: 'docinfo', title: '보고서 정보', icon: ClipboardList, desc: '표지와 개정 이력, 본문에 들어가는 호선, 선급, 도면 번호처럼 호선마다 다른 값을 적습니다. 비운 칸은 보고서에 [Not provided] 로 찍힙니다.' },
  { id: 'figures', title: '보고서 그림', icon: FileImage, desc: 'P&ID, Hogging/Sagging, Line 별 배관 모델, 노즐 하중 표처럼 호선마다 다른 그림을 폴더로 올립니다. 파일 이름은 보고서 그림 제목 그대로입니다. 없는 그림은 보고서에 자리 표시만 남습니다.' },
];

// 기본값이 미리 들어 있어 '입력 완료' 표시는 하지 않는다. 잘못된 값만 알리고, 빈 칸은 [보고서 만들기] 때 검사한다.
function stepState(sum) {
  if (sum?.invalid > 0) return { status: 'error', hint: `잘못된 값 ${sum.invalid}칸` };
  return { status: 'wait', hint: '' };
}

export default function PsaReportAutomation() {
  const { currentMenu, setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [input, setInput] = useState(createBlankInput);
  const [stepIdx, setStepIdx] = useState(0);
  const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, variant, onConfirm }
  const [uploads, setUploads] = useState({}); // key → { doneFiles, totalFiles }
  const loadInputRef = useRef(null);
  // 비동기 업로드가 최신 상태(작업 폴더 이름)를 읽도록
  const inputRef = useRef(input);
  inputRef.current = input;
  const wsPromiseRef = useRef(null);

  // 엑셀을 끌어 놓는 자리 밖에 떨어뜨려도 창이 그 파일을 열지 않게(Electron 기본 동작). 이 화면이 보일 때만.
  useEffect(() => {
    if (currentMenu !== PSA_REPORT_APP) return undefined;
    const block = (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block); };
  }, [currentMenu]);

  // 서버 작업 폴더에 남은 폴더와 맞춘다(앱을 다시 열거나 입력 파일을 불러온 뒤).
  const reconcileWithServer = async (ws) => {
    if (!ws) return;
    try {
      const targets = await describePsaWorkspace(ws);
      setInput(s => (s.workspace === ws ? reconcileFolders(s, targets) : s));
    } catch {
      // 서버에 못 붙으면 '다시 선택 필요' 상태로 둔다
    }
  };
  useEffect(() => { reconcileWithServer(input.workspace); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 서버 저장 — 작업 폴더의 psa_input.json(보고서 생성은 이 파일만 읽는다). 처음 연 순간은 저장하지 않는다.
  const [serverSave, setServerSave] = useState({ state: 'idle' }); // idle | saving | saved | error
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) { firstRunRef.current = false; return undefined; }
    const t = setTimeout(async () => {
      setServerSave({ state: 'saving' });
      try {
        let ws = await ensureWorkspace();
        try {
          await savePsaInput(ws, serializeInput({ ...inputRef.current, workspace: ws }));
        } catch (err) {
          if (err?.response?.status !== 404 && err?.response?.status !== 403) throw err;
          setInput(s => reconcileFolders(s, null));
          inputRef.current = { ...inputRef.current, workspace: null };
          ws = await ensureWorkspace();
          await savePsaInput(ws, serializeInput({ ...inputRef.current, workspace: ws }));
        }
        setServerSave({ state: 'saved', at: new Date() });
      } catch (err) {
        setServerSave({ state: 'error', message: psaUploadErrorMessage(err) });
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 보고서에 필요한 파일 체크리스트(서버가 Line 폴더 안 파일을 판별) ──
  const [checklist, setChecklist] = useState(null);
  const [topBusy, setTopBusy] = useState(false); // 고른 엑셀 여러 개를 차례로 올리는 중
  const [checkedKey, setCheckedKey] = useState(null); // 마지막으로 확인을 마친 폴더 상태(folderKey)
  const folderKeyRef = useRef('');
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState('');
  const refreshChecklist = async () => {
    const ws = inputRef.current.workspace;
    const key = folderKeyRef.current;
    if (!ws) { setChecklist(null); setCheckedKey(key); return; }
    setChecklistLoading(true);
    setChecklistError('');
    try {
      const targets = await getPsaChecklist(ws);
      setChecklist(targets || null);
      if (targets) setInput(s => applyChecklistSelections(s, targets));
    } catch (err) {
      setChecklistError(psaUploadErrorMessage(err));
    } finally {
      setCheckedKey(key);
      setChecklistLoading(false);
    }
  };
  // 폴더가 바뀌면(올리기 끝, 지우기, 불러오기, 서버 맞추기) 다시 확인. 올리는 중에는 기다린다.
  const folderKey = JSON.stringify([input.workspace, input.lines.map(l => [l.folder?.target, l.folder?.fileCount, l.folder?.stale, l.folder?.incomplete, l.folder?.uploading])]);
  const uploadingNow = Object.keys(uploads).length > 0;
  useEffect(() => {
    if (uploadingNow) return undefined;
    const t = setTimeout(refreshChecklist, 500);
    return () => clearTimeout(t);
  }, [folderKey, uploadingNow]); // eslint-disable-line react-hooks/exhaustive-deps
  folderKeyRef.current = folderKey;
  const fileCheck = useMemo(() => checklistSummary(input, checklist), [input, checklist]);

  // ── 보고서 그림 자리(서버가 그림 폴더에서 파일 이름으로 맞춘 결과) ──
  const [figures, setFigures] = useState(null);
  const [figuresLoading, setFiguresLoading] = useState(false);
  const [figuresError, setFiguresError] = useState('');
  const refreshFigures = async () => {
    const ws = inputRef.current.workspace;
    if (!ws) { setFigures(null); return; }
    setFiguresLoading(true);
    setFiguresError('');
    try {
      setFigures(await getPsaFigures(ws));
    } catch (err) {
      setFiguresError(psaUploadErrorMessage(err));
    } finally {
      setFiguresLoading(false);
    }
  };
  // 자리는 저장된 입력의 Line 과 모델 수로 정해진다 → 서버 저장이 끝난 뒤, 그림 폴더가 바뀐 뒤에 다시 묻는다
  const figureKey = JSON.stringify([input.workspace, input.figureFolder?.fileCount, input.figureFolder?.uploading, input.figureFolder?.incomplete,
    input.lines.map(l => [l.lineNo, l.modelCount])]);
  useEffect(() => {
    if (!input.workspace || input.figureFolder?.uploading || serverSave.state === 'saving') return undefined;
    const t = setTimeout(refreshFigures, 700);
    return () => clearTimeout(t);
  }, [figureKey, serverSave.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const figureCheck = useMemo(() => (figures ? { missing: figures.slots.filter(s => !s.file).map(s => s.label) } : null), [figures]);
  const docCheck = useMemo(() => docInfoSummary(input), [input]);
  // 올리기나 파일 찾기가 끝나기 전의 '폴더 없음, 빠진 파일'은 판정이 아니다
  const checkPending = folderKey !== checkedKey;
  const filesBusy = checklistBusy(input, checklist, { loading: checklistLoading, topBusy, error: checklistError, pending: checkPending }) && !checklistError;
  // 진행 창: 올리는 동안은 파일 수, 다 올린 뒤에는 '파일 찾는 중'. 서버 확인이 실패하면 닫힌다(오류는 파일 확인 단계에 보임).
  const busyOverlay = useMemo(() => {
    const running = Object.entries(uploads);
    if (topBusy || running.length) {
      const done = running.reduce((n, [, u]) => n + (u.doneFiles || 0), 0);
      const total = running.reduce((n, [, u]) => n + (u.totalFiles || 0), 0);
      const key = running[0]?.[0];
      const name = key ? (input.lines.find(l => l.uid === key)?.lineNo || (key === FIGURE_KEY ? '보고서 그림' : '')) : '';
      return { open: true, phase: 'upload', upload: { done, total, current: name || '' } };
    }
    return { open: filesBusy && input.lines.length > 0, phase: 'check' };
  }, [uploads, topBusy, filesBusy, input.lines]);

  const summary = useMemo(() => stepSummary(input), [input]);
  const steps = STEPS.map(s => {
    if (s.id === 'files') {
      if (filesBusy && input.lines.length) return { ...s, status: 'wait', hint: '파일 확인 중' };
      if (!input.lines.length || !checklist) return { ...s, status: 'wait', hint: '' };
      if (fileCheck.ready) return { ...s, status: 'wait', hint: '' };
      const parts = [];
      if (fileCheck.noFolder.length) parts.push(`폴더 없음 ${fileCheck.noFolder.length}`);
      if (fileCheck.missing.length) parts.push(`빠진 파일 ${fileCheck.missing.length}`);
      if (fileCheck.choose.length) parts.push(`고를 파일 ${fileCheck.choose.length}`);
      return { ...s, status: 'review', hint: parts.join(', ') };
    }
    if (s.id === 'docinfo') return { ...s, status: docCheck.empty ? 'review' : 'wait', hint: docCheck.empty ? `빈 칸 ${docCheck.empty}` : '' };
    if (s.id === 'figures') {
      const n = figureCheck?.missing.length || 0;
      return { ...s, status: n ? 'review' : 'wait', hint: figuresLoading ? '확인 중' : n ? `없는 그림 ${n}` : '' };
    }
    return { ...s, ...stepState(summary[s.id]) };
  });
  const step = STEPS[stepIdx];

  // [보고서 만들기] — 막을 것(block)이 있으면 그 단계로 보내고, 뺄 수 있는 것(skip)만 남으면 확인 창에서 승인받는다.
  // 누른 뒤부터 문제 목록을 보이고, 고치면 그 자리에서 줄어든다.
  const [reportTried, setReportTried] = useState(false);
  const problems = useMemo(() => reportProblems(input, fileCheck, figureCheck), [input, fileCheck, figureCheck]);
  const blocks = problems.filter(p => p.level === 'block');
  const skips = problems.filter(p => p.level === 'skip');
  const goStep = (id) => { const i = STEPS.findIndex(x => x.id === id); if (i >= 0) setStepIdx(i); };
  // 막는 항목으로 갈 때 고를 칸이면 체크리스트가 그 Line 을 펼친다
  const [checkFocus, setCheckFocus] = useState(null); // { uid, n }
  const goProblem = (pr) => {
    goStep(pr.step);
    if (pr.kind === 'choose' && pr.lineUid) setCheckFocus(f => ({ uid: pr.lineUid, n: (f?.n || 0) + 1 }));
  };
  // 승인 뒤: 빼는 자료를 입력에 적고 → 서버에 바로 저장(자동 저장 1.2초를 기다리지 않음) → 생성 → 내려받기
  const [reportRun, setReportRun] = useState({ state: 'idle' }); // idle | running | done | error
  // ── 검토(보고서와 따로) — 웹 창 / 검토용 Word. 둘 다 지금 입력으로 그 자리에서 만든다.
  // '고르기'가 남아도 막지 않는다(그 자리는 '자료 없음, 아직 고르지 않음'으로 보인다). 다른 막는 항목은 보고서와 같다.
  const [reviewView, setReviewView] = useState({ open: false, loading: false, error: '', data: null });
  const [reviewWord, setReviewWord] = useState({ state: 'idle' }); // idle | running | error
  const reviewBlocked = () => {
    if (filesBusy) {
      showToast('결과 엑셀을 올리고 시트를 확인하는 중입니다. 끝난 뒤 다시 누르세요.', 'info', 6000);
      goStep('files');
      return true;
    }
    const rb = reviewBlocks(problems);
    if (!rb.length) return false;
    setReportTried(true);
    showToast(`검토할 수 없습니다. ${rb[0].text}`, 'error', 9000);
    goProblem(rb[0]);
    return true;
  };
  const saveForReview = async () => {
    const ws = await ensureWorkspace();
    await savePsaInput(ws, serializeInput({ ...inputRef.current, workspace: ws }));
    return ws;
  };
  const openReview = async () => {
    if (reviewBlocked()) return;
    setReviewView({ open: true, loading: true, error: '', data: null });
    try {
      const ws = await saveForReview();
      setReviewView({ open: true, loading: false, error: '', data: await getPsaReview(ws, pendingChoices(fileCheck)) });
    } catch (err) {
      setReviewView({ open: true, loading: false, error: err?.message || psaUploadErrorMessage(err), data: null });
    }
  };
  const downloadReviewWord = async () => {
    if (reviewWord.state === 'running' || reviewBlocked()) return;
    setReviewWord({ state: 'running' });
    try {
      const ws = await saveForReview();
      const { blob, filename } = await generatePsaReport(ws, { review: true, pending: pendingChoices(fileCheck) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setReviewWord({ state: 'idle' });
      showToast(`검토용 Word 를 받았습니다: ${filename}`, 'success', 6000);
    } catch (err) {
      const message = err?.message || '검토용 Word 를 만들지 못했습니다.';
      setReviewWord({ state: 'error', message });
      showToast(message, 'error', 8000);
    }
  };
  // 최종 보고서(선주 제출용, 색 없음). 검토 창은 열지 않는다(사용자 결정 2026-11-18 — 보고서와 검토는 따로).
  const startReport = async (excluded) => {
    if (reportRun.state === 'running') return;
    const next = { ...inputRef.current, reportExclusions: excluded };
    patch(s => ({ ...s, reportExclusions: excluded }));
    setReportRun({ state: 'running' });
    try {
      const ws = await ensureWorkspace();
      await savePsaInput(ws, serializeInput({ ...next, workspace: ws }));
      const { blob, filename, warnings, missing } = await generatePsaReport(ws);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setReportRun({ state: 'done', filename, warnings, missing, excluded: excluded.length, at: new Date() });
      showToast(`보고서를 받았습니다: ${filename}`, 'success', 6000);
    } catch (err) {
      const message = err?.message || '보고서를 만들지 못했습니다.';
      setReportRun({ state: 'error', message });
      showToast(message, 'error', 8000);
    }
  };
  const makeReport = () => {
    if (filesBusy) {
      showToast('결과 엑셀을 올리고 시트를 확인하는 중입니다. 끝난 뒤 다시 누르세요.', 'info', 6000);
      goStep('files');
      return;
    }
    setReportTried(true);
    if (blocks.length) {
      // 무엇을 해야 하는지 알림에 바로 쓴다('고칠 항목 N건'만으로는 몰랐다 — 2026-11-18 사용자 혼란)
      const first = blocks[0];
      showToast(blocks.length === 1
        ? `보고서를 만들 수 없습니다. ${first.text}`
        : `보고서를 만들 수 없습니다. ${first.text} (외 ${blocks.length - 1}건, 왼쪽 목록 참고)`, 'error', 9000);
      goProblem(first);
      return;
    }
    if (!skips.length) { startReport([]); return; }
    setConfirm({
      title: '빠진 자료를 빼고 진행할까요?',
      variant: 'warning',
      confirmLabel: '빼고 진행',
      message: (
        <>
          <span className="block">아래 자료가 없습니다. 진행하면 보고서의 그 자리에 'Not provided'(자료 없음)를 적습니다.</span>
          {skips.map(pr => <span key={pr.text} className="mt-1 block font-semibold text-amber-800">{pr.text}</span>)}
          <span className="mt-2 block">자료를 채운 뒤 다시 만들면 그 자리가 채워집니다.</span>
        </>
      ),
      onConfirm: () => startReport(skips.map(pr => pr.text)),
    });
  };

  // ── 수정 함수 ──
  const patch = (fn) => setInput(prev => fn(prev));
  const patchRow = (listKey, uid, change) => patch(s => ({ ...s, [listKey]: s[listKey].map(r => (r.uid === uid ? { ...r, ...change } : r)) }));

  const setFolder = (key, folder) => {
    if (key === FIGURE_KEY) patch(s => ({ ...s, figureFolder: folder }));
    else patchRow('lines', key, { folder });
  };
  const folderOf = (key) => {
    if (key === FIGURE_KEY) return inputRef.current.figureFolder;
    return inputRef.current.lines.find(l => l.uid === key)?.folder;
  };

  // 작업 폴더는 입력 한 벌에 하나 — 동시에 두 폴더를 골라도 하나만 만든다.
  const ensureWorkspace = async () => {
    if (inputRef.current.workspace) return inputRef.current.workspace;
    if (!wsPromiseRef.current) {
      wsPromiseRef.current = createPsaWorkspace()
        .then(ws => {
          setInput(s => ({ ...s, workspace: ws }));
          inputRef.current = { ...inputRef.current, workspace: ws };
          return ws;
        })
        .finally(() => { wsPromiseRef.current = null; });
    }
    return wsPromiseRef.current;
  };

  const removeServerFolder = (target) => {
    const ws = inputRef.current.workspace;
    if (!ws || !target) return;
    removePsaFolder(ws, target).catch(err => showToast(`서버 폴더를 지우지 못했습니다: ${psaUploadErrorMessage(err)}`, 'warning'));
  };

  // 그림 칸 = 폴더(하위 구조 그대로), Line 칸 = 엑셀 하나. 같은 칸에서 다시 고르면 서버의 그 폴더를 비우고 새로 올린다.
  const pickFolder = async (key, fileList) => {
    const files = Array.from(fileList || []);
    const cur = inputRef.current;
    let target = FIGURE_TARGET;
    if (key !== FIGURE_KEY) {
      const line = cur.lines.find(l => l.uid === key);
      if (files.length !== 1 || !isExcelFile(files[0].name)) {
        showToast('Line 에는 CAESAR II 결과 엑셀(.xlsx) 하나를 고르세요.', 'error');
        return;
      }
      // 같은 줄은 쓰던 서버 폴더를 그대로(이름을 고쳐도), 처음이면 Line No. 로
      target = line?.folder?.target || uniqueServerFolder(cur.lines, key, line?.lineNo);
      if (!target) {
        showToast(`Line No. '${line?.lineNo ?? ''}' 는 폴더 이름으로 쓸 수 없습니다. 영문, 숫자, 공백 . _ ( ) - 로 40자 이내로 고친 뒤 다시 고르세요.`, 'error');
        return;
      }
    }
    const meta = summarizePickedFolder(files);
    if (!meta) return;
    const result = await uploadToTarget(key, target, files, meta);
    const what = key === FIGURE_KEY ? `그림 폴더(파일 ${files.length}개)` : files[0].name;
    if (!result.ok) {
      showToast(`${what} 를 올리지 못했습니다: ${result.message}`, 'error', 8000);
    } else if (result.drmFiles.length) {
      // 서버(백엔드 프로세스)가 회사 DRM 파일을 평문으로 읽으면 그대로 쓸 수 있다(70 확인). 못 읽으면 '보고서 파일 확인'에 '읽지 못한 엑셀'로 나온다.
      showToast(`${what} 를 올렸습니다(회사 DRM 파일 ${result.drmFiles.length}개). 서버가 읽지 못하면 '보고서 파일 확인'에 표시됩니다.`, 'success', 7000);
    } else {
      showToast(`${what} 를 올렸습니다.`, 'success');
    }
  };

  // 한 칸(Line 엑셀, 그림 폴더)의 파일을 서버 target 폴더에 올린다. 화면 칸 상태와 진행 막대를 함께 맞춘다.
  // depth = 서버 경로에서 뺄 앞 폴더 수(1 = 고른 폴더 이름 — 엑셀 하나면 파일 이름 그대로).
  const uploadToTarget = async (key, target, files, meta, { depth = 1, reset = true } = {}) => {
    const previousTarget = folderOf(key)?.target;
    setFolder(key, { ...meta, target, uploading: true });
    setUploads(prev => ({ ...prev, [key]: { doneFiles: 0, totalFiles: files.length } }));
    const onProgress = (p) => setUploads(prev => ({ ...prev, [key]: p }));
    try {
      let ws = await ensureWorkspace();
      let result;
      try {
        result = await uploadPsaFolder(ws, target, files, onProgress, { depth, reset });
      } catch (err) {
        if (err?.response?.status !== 404) throw err;
        // 작업 폴더가 서버에서 사라졌다(30일 정리 등) — 다른 폴더는 다시 선택 필요, 새 작업 폴더로 다시 올린다.
        setInput(s => reconcileFolders(s, null));
        inputRef.current = { ...inputRef.current, workspace: null };
        showToast('서버 작업 폴더가 정리되어 새로 만들었습니다. 다른 Line 엑셀은 다시 골라야 합니다.', 'warning');
        ws = await ensureWorkspace();
        result = await uploadPsaFolder(ws, target, files, onProgress, { depth });
      }
      setFolder(key, { ...meta, target });
      if (previousTarget && previousTarget !== target) removeServerFolder(previousTarget);
      return { ok: true, drmFiles: result.drmFiles };
    } catch (err) {
      setFolder(key, { ...meta, target, incomplete: true });
      return { ok: false, message: psaUploadErrorMessage(err), drmFiles: [] };
    } finally {
      setUploads(prev => { const { [key]: _x, ...rest } = prev; return rest; });
    }
  };

  // ── 보고서 그림 파일 더하기(여러 개 선택, 끌어 놓기 — 파일이나 폴더). 있던 그림은 두고 같은 이름만 덮어쓴다.
  // 폴더 선택(pickFolder)은 지금처럼 그림 전체를 바꾼다.
  const addFigureFiles = async (fileList) => {
    const all = Array.from(fileList || []);
    const files = all.filter(f => /\.(png|jpe?g|bmp|gif)$/i.test(f.name || ''));
    if (!files.length) {
      showToast('그림 파일(png, jpg, bmp, gif)이 없습니다. 파일 이름은 보고서 그림 제목 그대로입니다.', 'error', 7000);
      return;
    }
    const prev = folderOf(FIGURE_KEY);
    const keep = folderReady(prev);
    const meta = {
      name: keep ? prev.name : '그림 파일',
      fileCount: (keep ? prev.fileCount : 0) + files.length,
      totalBytes: (keep ? prev.totalBytes : 0) + files.reduce((n, f) => n + (f.size || 0), 0),
    };
    const r = await uploadToTarget(FIGURE_KEY, FIGURE_TARGET, files, meta, { reset: !keep });
    if (!r.ok) { showToast(`그림을 올리지 못했습니다: ${r.message}`, 'error', 8000); return; }
    // 같은 이름을 덮어쓰면 서버 파일 수가 더한 값보다 적다 — 서버 수로 맞춘다(아니면 '올리다 끊김'으로 보인다)
    try {
      const targets = await describePsaWorkspace(inputRef.current.workspace);
      const t = targets?.[FIGURE_TARGET];
      if (t) setFolder(FIGURE_KEY, { ...meta, fileCount: t.fileCount, totalBytes: t.totalBytes, target: FIGURE_TARGET });
    } catch {
      // 수를 못 맞춰도 그림은 올라갔다
    }
    const skipped = all.length - files.length;
    showToast(`그림 ${files.length}개를 올렸습니다.${skipped ? ` 그림이 아닌 파일 ${skipped}개는 뺐습니다.` : ''}`, 'success', 6000);
  };

  // ── 결과 엑셀 여러 개 한 번에: 엑셀 하나 = Line 하나(같은 Line No. 가 있으면 그 줄의 엑셀을 바꿈) ──
  const pickExcelFiles = (fileList) => {
    const plan = planExcelFiles(inputRef.current.lines, fileList);
    if (plan.assign.length === 0) {
      showToast('엑셀(.xlsx) 파일을 고르세요. CAESAR II 결과를 Line 마다 한 파일로 내보낸 것(예: TD-01.xlsx, TD-06_1.xlsx)입니다.', 'error', 8000);
      return;
    }
    const replace = plan.assign.filter(a => a.lineUid && folderOf(a.lineUid));
    if (!replace.length) { applyExcelFiles(plan); return; }
    setConfirm({
      title: '엑셀을 올릴까요?',
      variant: 'warning',
      confirmLabel: '올리기',
      message: (
        <>
          <span className="block">엑셀 {plan.assign.length}개: 새 Line {plan.assign.length - replace.length}개, 엑셀을 바꿀 Line {replace.length}개</span>
          <span className="mt-1 block font-semibold text-amber-800">바뀌는 Line: {replace.map(a => `${a.lineNo}(${folderOf(a.lineUid)?.name} → ${a.file.name})`).join(', ')}</span>
          {plan.skipped.length > 0 && <span className="mt-1 block text-xs">엑셀이 아니라 뺀 파일 {plan.skipped.length}개</span>}
        </>
      ),
      onConfirm: () => applyExcelFiles(plan),
    });
  };

  const applyExcelFiles = async (plan) => {
    const { input: planned, uidByNo } = applyExcelPlan(inputRef.current, plan);
    setInput(planned);
    inputRef.current = planned;
    setStepIdx(0);
    setTopBusy(true);
    const failed = [];
    let drm = 0;
    for (const a of plan.assign) {
      const uid = a.lineUid || uidByNo[a.lineNo.toUpperCase()];
      const cur = inputRef.current;
      const target = folderOf(uid)?.target || uniqueServerFolder(cur.lines, uid, a.lineNo);
      if (!target) { failed.push(`${a.file.name}: Line No. 를 폴더 이름으로 쓸 수 없음`); continue; }
      const meta = { name: a.file.name, fileCount: 1, totalBytes: a.file.size || 0 };
      const r = await uploadToTarget(uid, target, [a.file], meta);
      // 다음 줄이 같은 서버 폴더 이름을 쓰지 않게 바로 반영
      inputRef.current = { ...inputRef.current, lines: inputRef.current.lines.map(l => (l.uid === uid ? { ...l, folder: { ...meta, target } } : l)) };
      if (!r.ok) failed.push(`${a.file.name}: ${r.message}`);
      drm += r.drmFiles.length;
    }
    setTopBusy(false);
    if (failed.length) showToast(`올리지 못한 엑셀이 있습니다. ${failed.join(' / ')}`, 'error', 10000);
    else showToast(`엑셀 ${plan.assign.length}개를 올렸습니다. Line No. 와 Pipe Line 은 표에서 고칠 수 있습니다.`, 'success', 7000);
    if (plan.skipped.length) showToast(`엑셀이 아닌 파일 ${plan.skipped.length}개는 뺐습니다: ${plan.skipped.slice(0, 3).join(', ')}`, 'info', 7000);
    if (drm) showToast(`회사 DRM 엑셀 ${drm}개가 함께 올라갔습니다. 서버가 읽지 못하면 '보고서 파일 확인'에 표시됩니다.`, 'info', 7000);
  };
  const clearFolder = (key) => {
    removeServerFolder(folderOf(key)?.target);
    setFolder(key, null);
  };

  const askRemoveLine = (uid) => {
    const line = input.lines.find(l => l.uid === uid);
    const n = manifoldRowsUsingLine(input, uid);
    const doRemove = () => {
      removeServerFolder(line?.folder?.target);
      patch(s => removeLine(s, uid));
    };
    const hasServer = !!line?.folder?.target;
    if (n === 0 && !hasServer) { doRemove(); return; }
    const also = [n ? `Manifold Load ${n}줄` : '', hasServer ? `서버에 올린 엑셀(${line.folder.name})` : ''].filter(Boolean).join('과 ');
    setConfirm({
      title: `${line?.lineNo || '이 Line'} 삭제`,
      message: `Process Condition 줄과 ${also}도 함께 지워집니다. 되돌릴 수 없습니다.`,
      confirmLabel: '함께 삭제',
      onConfirm: doRemove,
    });
  };

  const askRemovePosition = (uid) => {
    const pos = input.accelPositions.find(p => p.uid === uid);
    const n = loadsUsingPosition(input, uid);
    if (n === 0) { patch(s => removePosition(s, uid)); return; }
    setConfirm({
      title: `${pos?.discipline || '이 Discipline'} 삭제`,
      message: `이 위치를 고른 하중 줄 ${n}개는 남고 Discipline 만 '선택 안 함'이 됩니다.`,
      confirmLabel: '삭제',
      onConfirm: () => patch(s => removePosition(s, uid)),
    });
  };

  const askReset = () => setConfirm({
    title: '새로 시작',
    message: 'Piping line 과 올린 엑셀, 그림이 모두 지워지고 처음 기본값으로 돌아갑니다. 엑셀은 새 작업 폴더로 다시 올려야 합니다. 필요하면 먼저 입력 파일을 저장하세요.',
    confirmLabel: '새로 시작',
    onConfirm: () => { setInput(createBlankInput()); setChecklist(null); setReportTried(false); setStepIdx(0); },
  });

  // ── 입력 파일 저장·불러오기 ──
  const saveInputFile = () => {
    const blob = new Blob([serializeInput(input)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `PSA_input_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onLoadInputFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = parseInputFile(await file.text());
      setInput(next);
      await reconcileWithServer(next.workspace);
      showToast(next.workspace ? '입력을 불러왔습니다. 서버에 남은 엑셀을 확인했습니다.' : '입력을 불러왔습니다.', 'success');
    } catch (err) {
      showToast(err.message || '입력 파일을 읽지 못했습니다.', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">
      <PageBanner gradient="from-brand-blue via-amber-900 to-amber-700" artName="doc">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setCurrentMenu('Productivity Apps')}
            aria-label="Productivity Apps 로 돌아가기"
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Wrench size={18} className="text-amber-300" aria-hidden="true" />
              {PSA_REPORT_APP}
            </h1>
            <p className="text-sm text-amber-100/90 mt-0.5">LNG 연료배관 PSA 평가보고서의 입력값을 정리합니다</p>
          </div>
        </div>
        <AppUsageStatsButton appName={PSA_REPORT_APP} />
      </PageBanner>

      <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0">
        {/* 왼쪽 레일 */}
        <aside className="lg:w-[260px] shrink-0 flex flex-col gap-3 lg:overflow-y-auto">
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="px-1 pb-2 text-xs font-bold text-slate-500">입력 단계</h2>
            <StepRail steps={steps} activeIdx={stepIdx} onSelect={setStepIdx} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="px-1 pb-2 text-xs font-bold text-slate-500">입력 파일</h2>
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={saveInputFile} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <Save size={15} className="text-slate-500" aria-hidden="true" /> 입력 파일 저장 (JSON)
              </button>
              <button type="button" onClick={() => loadInputRef.current?.click()} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <FolderInput size={15} className="text-slate-500" aria-hidden="true" /> 입력 파일 불러오기
              </button>
              <input ref={loadInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onLoadInputFile} />
              <button type="button" onClick={askReset} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <RotateCcw size={15} className="text-slate-500" aria-hidden="true" /> 새로 시작
              </button>
            </div>
            <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600" role="status" aria-live="polite">
              <p className="flex items-center gap-1.5 font-semibold">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    serverSave.state === 'saved' ? 'bg-emerald-600'
                      : serverSave.state === 'error' ? 'bg-red-600'
                        : serverSave.state === 'saving' ? 'bg-blue-600' : 'bg-slate-300'}`}
                  aria-hidden="true"
                />
                {serverSave.state === 'saved' && `서버에 저장됨 ${serverSave.at.toLocaleTimeString('ko-KR', { hour12: false })}`}
                {serverSave.state === 'saving' && '서버에 저장하는 중'}
                {serverSave.state === 'error' && `서버 저장 실패: ${serverSave.message}`}
                {serverSave.state === 'idle' && (input.workspace ? '서버 작업 폴더 연결됨' : '값을 고치면 서버에 저장합니다')}
              </p>
              <p className="mt-1 text-slate-500">입력값은 작업 폴더의 psa_input.json 에, 올린 엑셀과 그림은 같은 작업 폴더에 둡니다(30일 보관). 저장한 JSON 을 불러오면 그대로 이어집니다.</p>
              {input.workspace && <p className="mt-1 break-all text-slate-500">작업 폴더: {input.workspace}</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <button
              type="button"
              onClick={makeReport}
              disabled={reportRun.state === 'running'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-blue px-4 py-3 text-sm font-bold text-white hover:bg-brand-blue-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-wait disabled:opacity-60"
            >
              <FileText size={16} aria-hidden="true" /> {reportRun.state === 'running' ? '보고서 만드는 중' : '보고서 만들기'}
            </button>
            <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-slate-500">선주 제출용 최종본입니다. 색과 출처 표시가 없습니다.</p>
            {reportRun.state === 'running' && (
              <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-600" role="status">입력을 저장하고 보고서를 만들고 있습니다. 수십 초 걸릴 수 있습니다.</p>
            )}
            {reportRun.state === 'error' && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-900" role="alert">{reportRun.message}</p>
            )}
            {reportRun.state === 'done' && (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-900" role="status">
                <p className="font-bold">받음: {reportRun.filename}</p>
                <p>
                  {reportRun.missing ? `자료가 없어 'Not provided' 로 남은 자리 ${reportRun.missing}곳. ` : '모든 자리를 채웠습니다. '}
                  Word 로 열면 목차와 표 번호를 갱신할지 묻습니다. [예]를 누르세요.
                </p>
                {reportRun.warnings.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-amber-900">
                    {reportRun.warnings.map(w => <li key={w}>{w}</li>)}
                  </ul>
                )}
              </div>
            )}
            {reportTried && blocks.length > 0 && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2" role="alert">
                <p className="flex items-center gap-1.5 text-xs font-bold text-red-800">
                  <AlertCircle size={14} aria-hidden="true" /> 먼저 고쳐야 합니다 ({blocks.length}건)
                </p>
                <ul className="mt-1 flex flex-col">
                  {blocks.map(pr => (
                    <li key={pr.text}>
                      <button
                        type="button"
                        onClick={() => goProblem(pr)}
                        className="w-full rounded px-1 py-0.5 text-left text-[11px] leading-snug text-red-900 hover:bg-red-100"
                      >
                        {pr.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reportTried && skips.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                <p className="text-xs font-bold text-amber-900">빠진 자료 ({skips.length}건, 승인하면 빼고 진행)</p>
                <ul className="mt-1 flex flex-col">
                  {skips.map(pr => (
                    <li key={pr.text}>
                      <button
                        type="button"
                        onClick={() => goProblem(pr)}
                        className="w-full rounded px-1 py-0.5 text-left text-[11px] leading-snug text-amber-900 hover:bg-amber-100"
                      >
                        {pr.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reportTried && problems.length === 0 && (
              <p className="mt-2 px-1 text-[11px] leading-relaxed text-emerald-800">입력과 파일이 모두 갖춰졌습니다.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" aria-labelledby="psa-review-head">
            <h3 id="psa-review-head" className="px-1 text-xs font-bold text-slate-900">검토</h3>
            <p className="mt-0.5 px-1 text-[11px] leading-relaxed text-slate-500">지금 입력으로 바로 만듭니다. 보고서를 먼저 만들지 않아도 됩니다.</p>
            <button
              type="button"
              onClick={openReview}
              disabled={reviewView.loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-wait disabled:opacity-60"
            >
              <SearchCheck size={16} aria-hidden="true" /> 검토 결과 보기
            </button>
            <button
              type="button"
              onClick={downloadReviewWord}
              disabled={reviewWord.state === 'running'}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-wait disabled:opacity-60"
            >
              <FileDown size={16} aria-hidden="true" /> {reviewWord.state === 'running' ? '검토용 Word 만드는 중' : '검토용 Word 받기'}
            </button>
            {reviewWord.state === 'error' && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-900" role="alert">{reviewWord.message}</p>
            )}
            <ReviewColorKey />
          </section>

        </aside>

        {/* 오른쪽 작업면 */}
        <main className="flex-1 min-w-0 lg:overflow-y-auto">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">단계 {stepIdx + 1} / {STEPS.length}</p>
                <h2 className="mt-0.5 text-lg font-bold text-slate-900">{step.title}</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">{step.desc}</p>
              </div>
              {steps[stepIdx].hint && (
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                  steps[stepIdx].status === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}
                >
                  {steps[stepIdx].hint}
                </span>
              )}
            </header>

            {step.id === 'scope' && (
              <ExcelDropZone onFiles={pickExcelFiles} disabled={topBusy}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">결과 엑셀을 여기로 끌어 놓거나 선택 (여러 개, 폴더도 됨)</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-700">
                      CAESAR II 결과를 Line 마다 한 파일로 내보낸 엑셀입니다. 엑셀 하나가 Line 하나가 됩니다.
                      예: TD-01.xlsx → TD01, TD-06_1.xlsx → TD06-1. 같은 Line No. 가 있으면 그 줄의 엑셀을 바꿉니다.
                    </p>
                  </div>
                  <ExcelPickButton
                    multiple
                    onPick={pickExcelFiles}
                    disabled={topBusy}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-blue px-4 text-sm font-bold text-white hover:bg-brand-blue-dark disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    <FileSpreadsheet size={15} aria-hidden="true" /> {topBusy ? '올리는 중' : '결과 엑셀 선택'}
                  </ExcelPickButton>
                </div>
                <ScopeTable
                  input={input}
                  uploads={uploads}
                  onLineChange={(uid, change) => patchRow('lines', uid, change)}
                  onMove={(uid, d) => patch(s => moveLine(s, uid, d))}
                  onRemove={askRemoveLine}
                  onAdd={() => patch(addLine)}
                  onAddCompRm={() => patch(addCompRmLine)}
                  onPickFolder={pickFolder}
                  onClearFolder={clearFolder}
                />
              </ExcelDropZone>
            )}

            {step.id === 'files' && (
              <PsaChecklist
                input={input}
                checklist={checklist}
                summary={fileCheck}
                loading={checklistLoading}
                error={checklistError}
                onRefresh={refreshChecklist}
                onChoose={(uid, kind, model, path) => patch(s => chooseChecklistFile(s, uid, kind, model, path))}
                focus={checkFocus}
                topBusy={topBusy}
                pending={checkPending}
              />
            )}

            {step.id === 'docinfo' && (
              <PsaDocInfo
                input={input}
                summary={docCheck}
                onInfoChange={(key, value) => patch(s => ({ ...s, docInfo: { ...(s.docInfo || defaultDocInfo()), [key]: value } }))}
                onRevisionChange={(uid, change) => patch(s => ({ ...s, revisions: (s.revisions || []).map(r => (r.uid === uid ? { ...r, ...change } : r)) }))}
                onRevisionAdd={() => patch(s => ({ ...s, revisions: [...(s.revisions || []), { uid: newUid('R'), no: '', date: '', contents: '' }] }))}
                onRevisionRemove={(uid) => patch(s => ({ ...s, revisions: (s.revisions || []).filter(r => r.uid !== uid) }))}
                onLineChange={(uid, change) => patchRow('lines', uid, change)}
              />
            )}

            {step.id === 'figures' && (
              <PsaFigures
                status={figures}
                loading={figuresLoading}
                error={figuresError}
                folder={input.figureFolder}
                upload={uploads[FIGURE_KEY]}
                onPick={(fileList) => pickFolder(FIGURE_KEY, fileList)}
                onAddFiles={addFigureFiles}
                onRefresh={refreshFigures}
                hasWorkspace={!!input.workspace}
              />
            )}

            {step.id === 'process' && (
              <ProcessTable
                input={input}
                onCellChange={(uid, key, v) => patch(s => ({ ...s, process: { ...s.process, [uid]: { ...s.process[uid], [key]: v } } }))}
                onNotesChange={v => patch(s => ({ ...s, processNotes: v }))}
              />
            )}

            {step.id === 'displacement' && (
              <DisplacementTable
                input={input}
                onChange={(key, v) => patch(s => ({ ...s, displacement: { ...s.displacement, [key]: v } }))}
              />
            )}

            {step.id === 'accel' && (
              <div className="flex flex-col gap-6">
                <div>
                  <h3 className="mb-2 text-sm font-bold text-slate-800">위치 (Position, mm)</h3>
                  <AccelPositionTable
                    input={input}
                    onChange={(uid, change) => patchRow('accelPositions', uid, change)}
                    onRemove={askRemovePosition}
                    onAdd={() => patch(s => ({ ...s, accelPositions: [...s.accelPositions, { uid: newUid('P'), discipline: '', x: '', y: '', z: '' }] }))}
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-bold text-slate-800">가속도 하중 (Acceleration loads, g)</h3>
                  <AccelLoadTable
                    input={input}
                    onChange={(uid, change) => patchRow('accelLoads', uid, change)}
                    onRemove={uid => patch(s => ({ ...s, accelLoads: s.accelLoads.filter(a => a.uid !== uid) }))}
                    onAdd={() => patch(s => ({ ...s, accelLoads: [...s.accelLoads, { uid: newUid('A'), positionUid: s.accelPositions[0]?.uid ?? '', loadCondition: '', lines: '', x: '', y: '', z: '' }] }))}
                  />
                </div>
              </div>
            )}

            {step.id === 'manifold' && (
              <ManifoldTable
                input={input}
                onChange={(uid, change) => patchRow('manifold', uid, change)}
                onRemove={uid => patch(s => ({ ...s, manifold: s.manifold.filter(m => m.uid !== uid) }))}
                onAdd={() => patch(s => ({ ...s, manifold: [...s.manifold, { uid: newUid('M'), lineUid: '', size: '' }] }))}
              />
            )}

            <footer className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setStepIdx(i => Math.max(0, i - 1))}
                disabled={stepIdx === 0}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:invisible"
              >
                <ChevronLeft size={16} aria-hidden="true" /> {STEPS[stepIdx - 1]?.title}
              </button>
              <button
                type="button"
                onClick={() => setStepIdx(i => Math.min(STEPS.length - 1, i + 1))}
                disabled={stepIdx === STEPS.length - 1}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white hover:bg-brand-blue-dark disabled:invisible"
              >
                {STEPS[stepIdx + 1]?.title} <ChevronRight size={16} aria-hidden="true" />
              </button>
            </footer>
          </section>
        </main>
      </div>

      <PsaBusyOverlay open={busyOverlay.open} phase={busyOverlay.phase} upload={busyOverlay.upload} />
      <PsaReviewPanel
        isOpen={reviewView.open}
        onClose={() => setReviewView(v => ({ ...v, open: false }))}
        review={reviewView.data}
        loading={reviewView.loading}
        error={reviewView.error}
        onGoStep={goStep}
        onDownload={downloadReviewWord}
        downloading={reviewWord.state === 'running'}
      />
      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        variant={confirm?.variant || 'danger'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.onConfirm?.(); setConfirm(null); }}
      />
    </div>
  );
}
