/// <summary>
/// 시스템 관리자(Admin) 전용 사용자 관리 대시보드.
/// 사용자의 승인(is_active), 권한(is_admin) 토글 및 전체 메타데이터 수정/삭제를 지원합니다.
/// </summary>
import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  Users, Search, Shield, ShieldOff, Trash2, RefreshCw, Clock, Activity,
  UserCheck, Edit2, X, Building, Briefcase, Tag, CheckCircle2, ClipboardList,
  Download, BarChart3, ChevronRight
} from 'lucide-react';
import { getUsers, updateUser, deleteUser } from '../../api/admin';
import { getActivityLogs, getActivityLogsExportUrl } from '../../api/activity';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import UserStatisticsModal from '../../components/modals/UserStatisticsModal';
import { useToast } from '../../contexts/ToastContext';

const LOG_PAGE_SIZE = 100;
const todayString = () => new Date().toISOString().slice(0, 10);
const daysAgoString = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const ACTION_TYPE_LABELS = {
  LOGIN: '로그인',
  LOGOUT: '로그아웃',
  PAGE_VIEW: '페이지 조회',
  ANALYSIS_REQUEST: '해석 요청',
  ANALYSIS_COMPLETE: '해석 완료',
  ANALYSIS_FAILED: '해석 실패',
  FILE_DOWNLOAD: '파일 다운로드',
  PROGRAM_DOWNLOAD: '프로그램 다운로드',
  EXPORT_XLSX: 'Excel 내보내기',
  VERSION_UPDATE: '버전 업데이트',
};

const ACTION_TYPE_COLORS = {
  LOGIN: 'bg-emerald-100 text-emerald-700',
  LOGOUT: 'bg-slate-100 text-slate-600',
  PAGE_VIEW: 'bg-sky-100 text-sky-700',
  ANALYSIS_REQUEST: 'bg-violet-100 text-violet-700',
  ANALYSIS_COMPLETE: 'bg-emerald-100 text-emerald-700',
  ANALYSIS_FAILED: 'bg-red-100 text-red-700',
  FILE_DOWNLOAD: 'bg-blue-100 text-blue-700',
  PROGRAM_DOWNLOAD: 'bg-indigo-100 text-indigo-700',
  EXPORT_XLSX: 'bg-cyan-100 text-cyan-700',
  VERSION_UPDATE: 'bg-amber-100 text-amber-700',
};

const formatDetail = (detail) => {
  if (!detail) return '—';
  const priority = ['page', 'program_name', 'project_name', 'analysis_id', 'job_id', 'filename', 'source'];
  const entries = Object.entries(detail)
    .filter(([key]) => priority.includes(key))
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length > 0 ? entries.join(' | ') : JSON.stringify(detail);
};

// 상대 시간 포맷 — 활동성 컬럼/Pending 카드용
const relativeTime = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return '방금 전';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}개월 전`;
  return `${Math.floor(mon / 12)}년 전`;
};

export default function UserManagement() {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'active' | 'admin'

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [activityUser, setActivityUser] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityPage, setActivityPage] = useState(0);
  const [activityData, setActivityData] = useState({ total: 0, items: [] });
  const [activityFilters, setActivityFilters] = useState({
    action_type: '',
    date_from: daysAgoString(30),
    date_to: todayString(),
  });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await getUsers();
      // 승인 대기자(Pending)가 위로 오도록 정렬, 그다음 생성일 역순
      const sorted = response.data.sort((a, b) => {
        if (a.is_active === b.is_active) return new Date(b.created_at) - new Date(a.created_at);
        return a.is_active ? 1 : -1;
      });
      setUsers(sorted);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // 상태 즉각 토글 (승인/권한)
  const handleToggle = async (userId, field, currentValue) => {
    try {
      await updateUser(userId, { [field]: !currentValue });
      setUsers(users.map(u => u.id === userId ? { ...u, [field]: !currentValue } : u));
    } catch (error) {
      showToast('상태 업데이트에 실패했습니다.', 'error');
    }
  };

  const handleApprove = async (userId) => {
    try {
      await updateUser(userId, { is_active: true });
      setUsers(users.map(u => u.id === userId ? { ...u, is_active: true } : u));
      showToast('사용자가 승인되었습니다.', 'success');
    } catch (error) {
      showToast('승인 처리에 실패했습니다.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteTarget) return;
    try {
      await deleteUser(confirmDeleteTarget.id);
      setUsers(users.filter(u => u.id !== confirmDeleteTarget.id));
      setConfirmDeleteTarget(null);
    } catch (error) {
      showToast('사용자 삭제에 실패했습니다.', 'error');
    }
  };

  const openEditModal = (user) => {
    setEditingUser({ ...user });
    setIsEditModalOpen(true);
  };

  const fetchUserActivity = async (user, page = 0, filters = activityFilters) => {
    if (!user) return;
    setActivityLoading(true);
    try {
      const params = {
        employee_id: user.employee_id,
        skip: page * LOG_PAGE_SIZE,
        limit: LOG_PAGE_SIZE,
        date_from: filters.date_from || daysAgoString(30),
        date_to: filters.date_to || todayString(),
      };
      if (filters.action_type) params.action_type = filters.action_type;
      const res = await getActivityLogs(params);
      setActivityData(res.data || { total: 0, items: [] });
      setActivityPage(page);
    } catch {
      setActivityData({ total: 0, items: [] });
      showToast('사용자 활동 로그 조회에 실패했습니다.', 'error');
    } finally {
      setActivityLoading(false);
    }
  };

  const openActivityModal = (user) => {
    setActivityUser(user);
    const filters = { action_type: '', date_from: daysAgoString(30), date_to: todayString() };
    setActivityFilters(filters);
    fetchUserActivity(user, 0, filters);
  };

  const handleActivitySearch = () => {
    fetchUserActivity(activityUser, 0, activityFilters);
  };

  const handleActivityExport = () => {
    if (!activityUser) return;
    const url = getActivityLogsExportUrl({
      employee_id: activityUser.employee_id,
      action_type: activityFilters.action_type,
      date_from: activityFilters.date_from,
      date_to: activityFilters.date_to,
    });
    const token = localStorage.getItem('session_token') || '';
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${activityUser.employee_id}_activity_${todayString()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => showToast('CSV 내보내기에 실패했습니다.', 'error'));
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    try {
      const { id, name, company, department, position } = editingUser;
      await updateUser(id, { name, company, department, position });
      setIsEditModalOpen(false);
      fetchUsers();
    } catch (error) {
      showToast('사용자 정보 수정에 실패했습니다.', 'error');
    }
  };

  // 통계 — 상단 KPI
  const totalUsers   = users.length;
  const pendingList  = useMemo(() => users.filter(u => !u.is_active), [users]);
  const pendingUsers = pendingList.length;
  const adminUsers   = users.filter(u => u.is_admin).length;

  // 로그인 막대 정규화 — 가장 활발한 사용자의 로그인 수를 100% 로
  const maxLogin = useMemo(
    () => Math.max(1, ...users.map(u => u.login_count || 0)),
    [users]
  );

  const makeStats = (key) =>
    Object.entries(
      users.reduce((acc, u) => {
        const v = u[key] || '미입력';
        acc[v] = (acc[v] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

  const companyStats    = makeStats('company');
  const departmentStats = makeStats('department');
  const positionStats   = makeStats('position');

  const DIST_COLORS = {
    company:    { icon: 'text-blue-500',    bar: 'bg-blue-400'    },
    department: { icon: 'text-violet-500',  bar: 'bg-violet-400'  },
    position:   { icon: 'text-emerald-500', bar: 'bg-emerald-400' },
  };

  // 필터 + 검색 — Pending 은 별도 영역에 있으므로 모드에 따라 분기
  const filteredUsers = users.filter(user => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !term ||
      user.name.toLowerCase().includes(term) ||
      user.employee_id.toLowerCase().includes(term) ||
      (user.department && user.department.toLowerCase().includes(term));
    if (!matchesSearch) return false;
    if (filterMode === 'active') return user.is_active;
    if (filterMode === 'admin')  return user.is_admin;
    return true; // 'all'
  });

  const filterChips = [
    { key: 'all',    label: '전체',  count: totalUsers,  cls: 'bg-slate-800 text-white' },
    { key: 'active', label: 'Active', count: totalUsers - pendingUsers, cls: 'bg-emerald-600 text-white' },
    { key: 'admin',  label: 'Admin',  count: adminUsers,  cls: 'bg-red-600 text-white' },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">

      <PageHeader
        title="User Management"
        icon={Users}
        subtitle="시스템 접근 권한 부여 및 사용자 메타데이터를 관리합니다."
        accentColor="blue"
      />

      {/* 1. KPI — Total / Pending / Admin */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Total Users</p>
            <h3 className="text-3xl font-extrabold text-slate-800">{totalUsers}</h3>
            <p className="text-[11px] text-slate-400 mt-1">활성 {totalUsers - pendingUsers}명 · 대기 {pendingUsers}명</p>
          </div>
          <div className="p-4 bg-blue-50 text-blue-600 rounded-xl"><Users size={28}/></div>
        </div>
        <div className={`p-6 rounded-2xl border shadow-sm flex items-center justify-between ${
          pendingUsers > 0
            ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-300 ring-1 ring-amber-200/60'
            : 'bg-white border-slate-200'
        }`}>
          <div>
            <p className={`text-xs font-bold uppercase mb-1 ${pendingUsers > 0 ? 'text-amber-700' : 'text-slate-400'}`}>Pending Approval</p>
            <h3 className={`text-3xl font-extrabold ${pendingUsers > 0 ? 'text-amber-800' : 'text-slate-300'}`}>{pendingUsers}</h3>
            <p className="text-[11px] text-amber-600 mt-1">{pendingUsers > 0 ? '아래 카드에서 즉시 승인 가능' : '대기 중인 가입 요청 없음'}</p>
          </div>
          <div className={`p-4 rounded-xl shadow-sm ${pendingUsers > 0 ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-300'}`}>
            <Clock size={28}/>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Active Admins</p>
            <h3 className="text-3xl font-extrabold text-slate-800">{adminUsers}</h3>
            <p className="text-[11px] text-slate-400 mt-1">시스템 관리 권한 보유자</p>
          </div>
          <div className="p-4 bg-slate-100 text-brand-blue rounded-xl"><Shield size={28}/></div>
        </div>
      </div>

      {/* 2. 분포 통계 */}
      {users.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-slate-500" />
              <h3 className="text-sm font-extrabold text-slate-700 tracking-tight">조직 분포 통계</h3>
              <span className="text-[11px] text-slate-400 font-medium">회사 · 부서 · 직급 상위 5개</span>
            </div>
            <button
              type="button"
              onClick={() => setIsStatsModalOpen(true)}
              className="group inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-blue bg-white border border-brand-blue/20 rounded-lg hover:bg-brand-blue hover:text-white hover:border-brand-blue shadow-sm transition-all"
            >
              자세히 보기
              <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { label: '회사별 분포',  icon: Building,  data: companyStats,    key: 'company'    },
            { label: '부서별 분포',  icon: Briefcase, data: departmentStats, key: 'department' },
            { label: '직급별 분포',  icon: Tag,       data: positionStats,   key: 'position'   },
          ].map(({ label, icon: Icon, data, key }) => {
            const { icon: iconCls, bar: barCls } = DIST_COLORS[key];
            return (
              <div key={label} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Icon size={15} className={iconCls} />
                  <p className="text-xs font-bold text-slate-500 uppercase">{label}</p>
                </div>
                <ul className="space-y-2.5">
                  {data.slice(0, 5).map(([name, count]) => (
                    <li key={name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-700 font-medium truncate max-w-[140px]">{name}</span>
                        <span className="text-slate-400 font-bold ml-2">{count}명</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className={`${barCls} h-1.5 rounded-full transition-all duration-500`}
                             style={{ width: `${(count / totalUsers) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                  {data.length > 5 && (
                    <p className="text-[10px] text-slate-400 text-right mt-1">+{data.length - 5}개 더</p>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
        </div>
      )}

      {/* 3. 승인 대기 — 별도 하이라이트 영역 (Pending 이 있을 때만 표시) */}
      {pendingList.length > 0 && (
        <div className="mb-6 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 border-2 border-amber-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-md">
                <Clock size={20}/>
              </div>
              <div>
                <h3 className="text-base font-extrabold text-amber-900 flex items-center gap-2">
                  승인 대기
                  <span className="px-2 py-0.5 bg-amber-200 text-amber-900 text-xs rounded-full font-bold">
                    {pendingList.length}명
                  </span>
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">신규 가입자가 시스템 접근을 기다리고 있습니다.</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingList.map(u => (
              <div
                key={u.id}
                className="bg-white border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-2 hover:border-amber-400 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-11 w-11 rounded-xl bg-amber-100 text-amber-700 border border-amber-200 flex items-center justify-center font-bold text-lg shrink-0">
                    {u.name?.[0] || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">
                      {u.name}
                      <span className="text-[10px] text-slate-400 font-mono ml-1.5">{u.employee_id}</span>
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {u.department || u.company || '소속 미입력'}
                      {u.created_at && <span className="text-slate-400"> · {relativeTime(u.created_at)} 가입</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleApprove(u.id)}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer flex items-center gap-1"
                    title="가입 승인"
                  >
                    <CheckCircle2 size={13}/> 승인
                  </button>
                  <button
                    onClick={() => setConfirmDeleteTarget(u)}
                    className="px-2.5 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                    title="가입 거절 (계정 삭제)"
                  >
                    거절
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Controls — 필터 칩 + 검색 + 갱신 */}
      <div className="flex flex-wrap items-center gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
          {filterChips.map(c => (
            <button
              key={c.key}
              onClick={() => setFilterMode(c.key)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                filterMode === c.key
                  ? `${c.cls} shadow-sm`
                  : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
              }`}
            >
              {c.label}
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                filterMode === c.key ? 'bg-white/20' : 'bg-slate-200 text-slate-500'
              }`}>{c.count}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/>
          <input
            type="text"
            placeholder="이름, 사번, 부서로 검색..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:border-blue-500 outline-none transition-colors"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">
            {filteredUsers.length} / {totalUsers} 표시
          </span>
          <button
            onClick={fetchUsers}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw size={14}/> 갱신
          </button>
        </div>
      </div>

      {/* 5. Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-4 px-6 font-bold">User / ID</th>
                <th className="py-4 px-6 font-bold">Affiliation</th>
                <th className="py-4 px-6 font-bold w-[240px]">Activity</th>
                <th className="py-4 px-6 font-bold text-center">Status</th>
                <th className="py-4 px-6 font-bold text-center">Admin</th>
                <th className="py-4 px-6 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="6" className="text-center py-20 text-slate-400">
                  <RefreshCw className="animate-spin inline-block mb-2"/>
                  <p>데이터를 불러오는 중입니다...</p>
                </td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-20 text-slate-400">
                  검색 결과가 없습니다.
                </td></tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.id} className={`transition-colors hover:bg-blue-50/50 ${!user.is_active ? 'bg-amber-50/40' : ''}`}>

                  {/* 이름 & 사번 */}
                  <td className="py-3 px-6">
                    <button
                      type="button"
                      onClick={() => openActivityModal(user)}
                      className="flex items-center gap-3 text-left cursor-pointer group"
                      title="사용자 활동 로그 보기"
                    >
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm border ${user.is_active ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                        {user.name?.[0] || '?'}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 group-hover:text-blue-700">{user.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono tracking-wider">{user.employee_id}</p>
                      </div>
                    </button>
                  </td>

                  {/* 소속 & 직급 */}
                  <td className="py-3 px-6">
                    <p className="text-sm font-bold text-slate-700">{user.department || '-'}</p>
                    <p className="text-xs text-slate-500">{user.company || '-'} / {user.position || '-'}</p>
                  </td>

                  {/* 활동성: 로그인 막대 + 해석 수 + 마지막 로그인 */}
                  <td className="py-3 px-6">
                    <div className="space-y-1.5 max-w-[220px]">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-700 w-7 text-right">{user.login_count ?? 0}</span>
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((user.login_count ?? 0) / maxLogin) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider">logins</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1" title="총 해석 수행 건수">
                          <Activity size={11} className="text-emerald-500"/>
                          <span className="font-bold text-slate-700">{user.analysis_count ?? 0}</span>
                          <span>해석</span>
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-400" title={user.last_login || '미접속'}>
                          {user.last_login ? relativeTime(user.last_login) : '미접속'}
                        </span>
                      </div>
                      {user.created_at && (
                        <p className="text-[10px] text-slate-400 font-mono">
                          가입 {new Date(user.created_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* 승인 상태 — Pending 카드가 있으므로 테이블은 상태 표시 중심 */}
                  <td className="py-3 px-6 text-center">
                    {user.is_active ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        Active
                      </span>
                    ) : (
                      <button
                        onClick={() => handleApprove(user.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors cursor-pointer"
                        title="클릭하여 승인"
                      >
                        <UserCheck size={12}/> Approve
                      </button>
                    )}
                  </td>

                  {/* 관리자 권한 토글 */}
                  <td className="py-3 px-6 text-center">
                    <button
                      onClick={() => handleToggle(user.id, 'is_admin', user.is_admin)}
                      className={`p-2 rounded-lg transition-colors cursor-pointer ${user.is_admin ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'}`}
                      title={user.is_admin ? "관리자 권한 해제" : "관리자 권한 부여"}
                    >
                      {user.is_admin ? <Shield size={20}/> : <ShieldOff size={20}/>}
                    </button>
                  </td>

                  {/* 수정 및 삭제 버튼 */}
                  <td className="py-3 px-6 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openActivityModal(user)} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors cursor-pointer" title="활동 로그">
                        <ClipboardList size={18}/>
                      </button>
                      <button onClick={() => openEditModal(user)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="정보 수정">
                        <Edit2 size={18}/>
                      </button>
                      <button onClick={() => setConfirmDeleteTarget(user)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="계정 삭제">
                        <Trash2 size={18}/>
                      </button>
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. 정보 수정 모달 */}
      <Transition appear show={isEditModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsEditModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <div className="bg-brand-blue p-5 flex justify-between items-center text-white">
                <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                  <Edit2 size={18} className="text-blue-400"/> 사용자 정보 수정
                </Dialog.Title>
                <button onClick={() => setIsEditModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors cursor-pointer"><X size={20}/></button>
              </div>

              <form onSubmit={handleEditSave} className="p-6 bg-slate-50 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">사번 (Employee ID)</label>
                  <input type="text" disabled value={editingUser?.employee_id || ''} className="w-full p-2.5 bg-slate-200 border border-slate-300 rounded-lg text-slate-500 font-mono text-sm cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"><Tag size={14}/> 이름</label>
                  <input type="text" required value={editingUser?.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"><Building size={14}/> 회사</label>
                  <input type="text" required value={editingUser?.company || ''} onChange={e => setEditingUser({...editingUser, company: e.target.value})} className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"><Users size={14}/> 부서</label>
                  <input type="text" required value={editingUser?.department || ''} onChange={e => setEditingUser({...editingUser, department: e.target.value})} className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 focus:border-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"><Briefcase size={14}/> 직급</label>
                  <input type="text" required value={editingUser?.position || ''} onChange={e => setEditingUser({...editingUser, position: e.target.value})} className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 focus:border-blue-500 outline-none" />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 font-bold rounded-lg hover:bg-slate-50 cursor-pointer">취소</button>
                  <button type="submit" className="px-6 py-2 bg-brand-green text-white font-bold rounded-lg hover:opacity-90 shadow-md cursor-pointer">정보 저장</button>
                </div>
              </form>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      {/* 7. 사용자별 활동 로그 모달 */}
      <Transition appear show={!!activityUser} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setActivityUser(null)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-5xl max-h-[86vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <div className="bg-slate-900 p-5 flex justify-between items-center text-white">
                <div>
                  <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                    <ClipboardList size={19} className="text-teal-300"/> 사용자 활동 로그
                  </Dialog.Title>
                  <p className="text-xs text-slate-300 mt-1">
                    {activityUser?.name} · {activityUser?.employee_id} · 최근 최대 30일
                  </p>
                </div>
                <button onClick={() => setActivityUser(null)} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors cursor-pointer">
                  <X size={20}/>
                </button>
              </div>

              <div className="p-4 border-b border-slate-200 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">이벤트</label>
                    <select
                      value={activityFilters.action_type}
                      onChange={e => setActivityFilters(f => ({ ...f, action_type: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white"
                    >
                      <option value="">전체</option>
                      {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">시작일</label>
                    <input
                      type="date"
                      value={activityFilters.date_from}
                      min={daysAgoString(30)}
                      max={todayString()}
                      onChange={e => setActivityFilters(f => ({ ...f, date_from: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">종료일</label>
                    <input
                      type="date"
                      value={activityFilters.date_to}
                      min={daysAgoString(30)}
                      max={todayString()}
                      onChange={e => setActivityFilters(f => ({ ...f, date_to: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                  </div>
                  <button
                    onClick={handleActivitySearch}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors cursor-pointer"
                  >
                    <Search size={13}/> 조회
                  </button>
                  <button
                    onClick={handleActivityExport}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <Download size={13}/> CSV
                  </button>
                </div>
              </div>

              <div className="overflow-auto flex-1">
                <table className="w-full text-xs text-slate-700">
                  <thead className="sticky top-0 bg-white border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">시간</th>
                      <th className="px-4 py-3 text-left">이벤트</th>
                      <th className="px-4 py-3 text-left">상태</th>
                      <th className="px-4 py-3 text-left">세부정보</th>
                      <th className="px-4 py-3 text-left">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLoading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-slate-400">
                          <RefreshCw size={16} className="inline animate-spin mr-2" />불러오는 중...
                        </td>
                      </tr>
                    ) : activityData.items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-slate-400">최근 30일 내 기록된 활동이 없습니다.</td>
                      </tr>
                    ) : activityData.items.map(row => (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ACTION_TYPE_COLORS[row.action_type] || 'bg-slate-100 text-slate-600'}`}>
                            {ACTION_TYPE_LABELS[row.action_type] || row.action_type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.status === 'success' ? 'text-emerald-600' : row.status === 'failure' ? 'text-red-500' : 'text-slate-400'}`}>
                            {row.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 max-w-[420px] truncate" title={JSON.stringify(row.action_detail)}>
                          {formatDetail(row.action_detail)}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-400">{row.ip_address || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {activityData.total > LOG_PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
                  <p className="text-xs text-slate-400">총 {activityData.total}건</p>
                  <div className="flex gap-2">
                    <button
                      disabled={activityPage === 0}
                      onClick={() => fetchUserActivity(activityUser, activityPage - 1)}
                      className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                    >이전</button>
                    <span className="px-3 py-1 text-xs text-slate-500">
                      {activityPage + 1} / {Math.ceil(activityData.total / LOG_PAGE_SIZE)}
                    </span>
                    <button
                      disabled={(activityPage + 1) * LOG_PAGE_SIZE >= activityData.total}
                      onClick={() => fetchUserActivity(activityUser, activityPage + 1)}
                      className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                    >다음</button>
                  </div>
                </div>
              )}
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      <ConfirmDialog
        isOpen={!!confirmDeleteTarget}
        onCancel={() => setConfirmDeleteTarget(null)}
        onConfirm={handleDelete}
        title="사용자 삭제"
        message={`'${confirmDeleteTarget?.name}' 사용자를 시스템에서 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
      />

      <UserStatisticsModal
        isOpen={isStatsModalOpen}
        onClose={() => setIsStatsModalOpen(false)}
        users={users}
      />
    </div>
  );
}
