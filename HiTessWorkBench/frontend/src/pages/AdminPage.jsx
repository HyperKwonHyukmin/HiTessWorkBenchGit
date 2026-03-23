import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { 
  Users, Search, Shield, ShieldOff, Trash2, RefreshCw, Calendar, Clock
} from 'lucide-react';
import { API_BASE_URL } from '../config';

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // 유저 목록 불러오기
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/users`);
      setUsers(response.data);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // 상태 변경 (승인/관리자)
  const handleStatusChange = async (userId, field, currentValue) => {
    try {
      await axios.put(`${API_BASE_URL}/api/users/${userId}`, { [field]: !currentValue });
      setUsers(users.map(u => u.id === userId ? { ...u, [field]: !currentValue } : u));
    } catch (error) {
      alert("업데이트 실패");
    }
  };

  // 유저 삭제
  const handleDelete = async (userId) => {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/users/${userId}`);
      setUsers(users.filter(u => u.id !== userId));
    } catch (error) {
      alert("삭제 실패");
    }
  };

  // 검색 필터링
  const filteredUsers = users.filter(user => 
    user.name.includes(searchTerm) || user.employee_id.includes(searchTerm) || user.department?.includes(searchTerm)
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Shield className="text-red-600"/> Administrator Mode
          </h1>
          <p className="text-sm text-gray-500">사용자 권한 관리 및 통계</p>
        </div>
        <div className="flex gap-2">
            <button onClick={fetchUsers} className="p-2 hover:bg-slate-100 rounded-full"><RefreshCw size={20}/></button>
            <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"/>
                <input type="text" placeholder="검색 (이름, 사번, 부서)" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="pl-9 pr-4 py-2 border rounded-lg text-sm w-64"/>
            </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-gray-200 text-gray-500 text-xs uppercase">
            <tr>
              <th className="py-3 px-6">User Info</th>
              <th className="py-3 px-6">Department / Position</th>
              <th className="py-3 px-6 text-center">Join Date</th>
              <th className="py-3 px-6 text-center">Logins</th>
              <th className="py-3 px-6 text-center">Status</th>
              <th className="py-3 px-6 text-center">Admin</th>
              <th className="py-3 px-6 text-center">Delete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? <tr><td colSpan="7" className="text-center py-10">Loading...</td></tr> : 
             filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-4 px-6">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center font-bold mr-3 border">{user.name[0]}</div>
                    <div>
                      <p className="font-bold text-slate-700">{user.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{user.employee_id}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-6">
                  <p className="text-sm font-bold text-slate-700">{user.department || '-'}</p>
                  <p className="text-xs text-gray-500">{user.company} / {user.position}</p>
                </td>
                <td className="py-4 px-6 text-center text-xs text-gray-500">
                   <div className="flex flex-col items-center">
                     <span className="flex items-center gap-1"><Calendar size={12}/> {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</span>
                     <span className="text-[10px] text-gray-400">{user.created_at ? new Date(user.created_at).toLocaleTimeString() : ''}</span>
                   </div>
                </td>
                <td className="py-4 px-6 text-center">
                   <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold">{user.login_count}회</span>
                </td>
                <td className="py-4 px-6 text-center">
                  <button onClick={()=>handleStatusChange(user.id, 'is_active', user.is_active)}
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${user.is_active ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200 animate-pulse'}`}>
                    {user.is_active ? 'Active' : 'Pending'}
                  </button>
                </td>
                <td className="py-4 px-6 text-center">
                  <button onClick={()=>handleStatusChange(user.id, 'is_admin', user.is_admin)} className={user.is_admin ? 'text-red-600' : 'text-gray-300'}>
                    {user.is_admin ? <Shield size={20}/> : <ShieldOff size={20}/>}
                  </button>
                </td>
                <td className="py-4 px-6 text-center">
                  <button onClick={()=>handleDelete(user.id)} className="text-gray-300 hover:text-red-600"><Trash2 size={18}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}