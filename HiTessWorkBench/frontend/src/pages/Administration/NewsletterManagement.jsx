/**
 * NewsletterManagement — 관리자 전용 뉴스레터 업로드/관리 페이지
 *
 * 기능:
 *  - PDF 업로드 폼 (제목 필수, 발행일 선택, 설명 선택, PDF 필수)
 *  - 등록된 뉴스레터 목록 + 삭제
 * 스타일: UserManagement.jsx / UsageReports.jsx 패턴 준수
 */
import React, { useEffect, useState, useRef } from 'react';
import { FileText, Upload, Trash2, RefreshCw, Calendar, AlertCircle, FileUp, X } from 'lucide-react';
import { getNewsletters, uploadNewsletter, deleteNewsletter } from '../../api/newsletters';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';

/** 발행일 포매터: ISO → YYYY.MM.DD */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

export default function NewsletterManagement() {
  const { showToast } = useToast();

  // 목록 상태
  const [newsletters, setNewsletters] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  // 업로드 폼 상태
  const [title, setTitle] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // 삭제 확인 다이얼로그
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, title }

  // 목록 로드
  const fetchList = () => {
    setListLoading(true);
    setListError('');
    getNewsletters()
      .then((res) => {
        setNewsletters(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        setListError('뉴스레터 목록을 불러오는 데 실패했습니다.');
      })
      .finally(() => setListLoading(false));
  };

  useEffect(() => {
    fetchList();
  }, []);

  // 파일 선택
  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') {
      showToast('PDF 파일만 업로드할 수 있습니다.', 'error');
      return;
    }
    setFile(f);
  };

  const handleFileClear = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 업로드 제출
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast('제목은 필수 항목입니다.', 'error');
      return;
    }
    if (!file) {
      showToast('PDF 파일을 선택해 주세요.', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('title', title.trim());
    if (issueDate) formData.append('issue_date', issueDate);
    if (description.trim()) formData.append('description', description.trim());
    formData.append('file', file);

    setUploading(true);
    try {
      await uploadNewsletter(formData);
      showToast('뉴스레터가 성공적으로 등록되었습니다.', 'success');
      // 폼 초기화
      setTitle('');
      setIssueDate('');
      setDescription('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchList();
    } catch (err) {
      const msg = err?.response?.data?.detail || '업로드 중 오류가 발생했습니다.';
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  // 삭제 확인
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteNewsletter(deleteTarget.id);
      showToast('뉴스레터가 삭제되었습니다.', 'success');
      fetchList();
    } catch {
      showToast('삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title="뉴스레터 관리"
        icon={FileText}
        subtitle="HiTESS 뉴스레터 PDF 업로드 및 아카이브 관리"
        accentColor="blue"
      />

      {/* 업로드 폼 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileUp size={16} className="text-blue-500" />
          <h2 className="text-sm font-bold text-slate-700">새 뉴스레터 등록</h2>
        </div>
        <form onSubmit={handleUpload} className="px-5 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* 제목 */}
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                제목 <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: HiTESS WorkBench 2026년 6월호"
                maxLength={200}
                required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-colors"
              />
            </div>

            {/* 발행일 */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                발행일 <span className="text-slate-400 font-normal ml-1">(선택)</span>
              </label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-colors"
              />
            </div>

            {/* PDF 파일 */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                PDF 파일 <span className="text-red-500 ml-0.5">*</span>
              </label>
              {file ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <FileText size={14} className="text-blue-500 shrink-0" />
                  <span className="text-xs font-medium text-blue-700 truncate flex-1">{file.name}</span>
                  <button
                    type="button"
                    onClick={handleFileClear}
                    className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors cursor-pointer"
                    aria-label="파일 선택 해제"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors group">
                  <Upload size={14} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                  <span className="text-xs text-slate-500 group-hover:text-blue-600 transition-colors">PDF 파일 선택</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* 설명 */}
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              설명 <span className="text-slate-400 font-normal ml-1">(선택)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이번 호의 주요 내용을 간략히 적어주세요..."
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-colors resize-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center gap-2 px-5 py-2 bg-[#002554] hover:bg-[#003580] active:bg-[#001a3d] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {uploading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  업로드 중...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  등록
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* 등록된 목록 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-slate-500" />
            <h2 className="text-sm font-bold text-slate-700">등록된 뉴스레터</h2>
            {!listLoading && (
              <span className="text-xs text-slate-400 font-medium">
                총 {newsletters.length}건
              </span>
            )}
          </div>
          <button
            onClick={fetchList}
            disabled={listLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
            aria-label="목록 새로고침"
          >
            <RefreshCw size={13} className={listLoading ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <th className="py-3 px-4 font-bold w-12 text-center">ID</th>
                <th className="py-3 px-4 font-bold">제목</th>
                <th className="py-3 px-4 font-bold w-28">발행일</th>
                <th className="py-3 px-4 font-bold w-36">설명</th>
                <th className="py-3 px-4 font-bold w-28">등록일</th>
                <th className="py-3 px-4 font-bold w-16 text-center">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {listLoading && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw size={18} className="animate-spin text-blue-400" />
                      <span>목록을 불러오는 중...</span>
                    </div>
                  </td>
                </tr>
              )}
              {!listLoading && listError && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-red-500 text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle size={18} />
                      <span>{listError}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!listLoading && !listError && newsletters.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 text-sm">
                    등록된 뉴스레터가 없습니다.
                  </td>
                </tr>
              )}
              {!listLoading && !listError && newsletters.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 text-center text-xs font-bold text-slate-400">{item.id}</td>
                  <td className="py-3 px-4">
                    <span className="text-sm font-bold text-slate-800">{item.title}</span>
                  </td>
                  <td className="py-3 px-4">
                    {item.issue_date ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                        <Calendar size={11} className="text-slate-400" />
                        {formatDate(item.issue_date)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs text-slate-500 line-clamp-2">
                      {item.description || '-'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => setDeleteTarget({ id: item.id, title: item.title })}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      aria-label={`${item.title} 삭제`}
                      title="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 삭제 확인 다이얼로그 */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={!!deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
          title="뉴스레터 삭제"
          message={`"${deleteTarget.title}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          variant="danger"
        />
      )}
    </div>
  );
}
