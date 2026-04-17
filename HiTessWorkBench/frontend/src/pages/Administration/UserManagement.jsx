/// <summary>
/// 시스템 관리자(Admin) 전용 사용자 관리 대시보드.
/// 사용자의 승인(is_active), 권한(is_admin) 토글 및 전체 메타데이터 수정/삭제를 지원합니다.
/// </summary>
import React, { useEffect, useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  Users, Search, Shield, ShieldOff, Trash2, RefreshCw, Calendar,
  Clock, UserCheck, UserX, Edit2, X, Building, Briefcase, Tag
} from 'lucide-react';
import { getUsers, updateUser, deleteUser } from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';

export default function UserManagement() {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null);

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

  // 편집 모달 열기
  const openEditModal = (user) => {
    setEditingUser({ ...user });
    setIsEditModalOpen(true);
  };

  // 편집 데이터 저장
  const handleEditSave = async (e) => {
    e.preventDefault();
    try {
      const { id, name, company, department, position } = editingUser;
      await updateUser(id, { name, company, department, position });
      setIsEditModalOpen(false);
      fetchUsers(); // 갱신
    } catch (error) {
      showToast('사용자 정보 수정에 실패했습니다.', 'error');
    }
  };

  // 통계 계산
  const totalUsers = users.length;
  const pendingUsers = users.filter(u => !u.is_active).length;
  const adminUsers = users.filter(u => u.is_admin).length;

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

  // 검색 필터링
  const filteredUsers = users.filter(user => 
    user.name.includes(searchTerm) || 
    user.employee_id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (user.department && user.department.includes(searchTerm))
  );

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      
      <PageHeader
        title="User Management"
        icon={Users}
        subtitle="시스템 접근 권한 부여 및 사용자 메타데이터를 관리합니다."
        accentColor="blue"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
           <div>
             <p className="text-xs font-bold text-slate-400 uppercase mb-1">Total Users</p>
             <h3 className="text-3xl font-extrabold text-slate-800">{totalUsers}</h3>
           </div>
           <div className="p-4 bg-blue-50 text-blue-600 rounded-xl"><Users size={28}/></div>
        </div>
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 p-6 rounded-2xl border border-yellow-200 shadow-sm flex items-center justify-between">
           <div>
             <p className="text-xs font-bold text-yellow-600 uppercase mb-1">Pending Approval</p>
             <h3 className="text-3xl font-extrabold text-yellow-700">{pendingUsers}</h3>
           </div>
           <div className="p-4 bg-white text-yellow-500 rounded-xl shadow-sm"><Clock size={28}/></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
           <div>
             <p className="text-xs font-bold text-slate-400 uppercase mb-1">Active Admins</p>
             <h3 className="text-3xl font-extrabold text-slate-800">{adminUsers}</h3>
           </div>
           <div className="p-4 bg-slate-100 text-brand-blue rounded-xl"><Shield size={28}/></div>
        </div>
      </div>

      {/* 2. 분포 통계 */}
      {users.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
      )}

      {/* 3. Controls */}
      <div className="flex justify-between items-center mb-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/>
            <input 
              type="text" 
              placeholder="이름, 사번, 부서로 검색..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:border-blue-500 outline-none transition-colors"
            />
        </div>
        <button onClick={fetchUsers} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors shadow-sm cursor-pointer">
          <RefreshCw size={16}/> <span>목록 갱신</span>
        </button>
      </div>

      {/* 3. Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-4 px-6 font-bold">User / ID</th>
                <th className="py-4 px-6 font-bold">Affiliation</th>
                <th className="py-4 px-6 font-bold text-center">Join Date</th>
                <th className="py-4 px-6 font-bold text-center">Access</th>
                <th className="py-4 px-6 font-bold text-center">Admin</th>
                <th className="py-4 px-6 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="6" className="text-center py-20 text-slate-400"><RefreshCw className="animate-spin inline-block mb-2"/><p>데이터를 불러오는 중입니다...</p></td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-20 text-slate-400">검색 결과가 없습니다.</td></tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.id} className={`transition-colors hover:bg-blue-50/50 ${!user.is_active ? 'bg-yellow-50/30' : ''}`}>
                  
                  {/* 이름 & 사번 */}
                  <td className="py-3 px-6">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm border ${user.is_active ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-200 text-slate-500 border-slate-300'}`}>
                        {user.name[0]}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{user.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono tracking-wider">{user.employee_id}</p>
                      </div>
                    </div>
                  </td>
                  
                  {/* 소속 & 직급 */}
                  <td className="py-3 px-6">
                    <p className="text-sm font-bold text-slate-700">{user.department || '-'}</p>
                    <p className="text-xs text-slate-500">{user.company} / {user.position}</p>
                  </td>
                  
                  {/* 가입일 */}
                  <td className="py-3 px-6 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-slate-600 font-medium">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{user.login_count} Logins</span>
                    </div>
                  </td>

                  {/* 승인 상태 토글 */}
                  <td className="py-3 px-6 text-center">
                    <button 
                      onClick={() => handleToggle(user.id, 'is_active', user.is_active)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-1.5 mx-auto rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        user.is_active 
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-brand-blue text-white shadow-md hover:bg-brand-blue-dark animate-pulse'
                      }`}
                    >
                      {user.is_active ? <><UserCheck size={14}/> Approved</> : <><UserX size={14}/> Approve?</>}
                    </button>
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

      {/* 4. 정보 수정 모달 */}
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
                {/* ID는 수정 불가 (읽기 전용) */}
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

      <ConfirmDialog
        isOpen={!!confirmDeleteTarget}
        onCancel={() => setConfirmDeleteTarget(null)}
        onConfirm={handleDelete}
        title="사용자 삭제"
        message={`'${confirmDeleteTarget?.name}' 사용자를 시스템에서 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
      />
    </div>
  );
}