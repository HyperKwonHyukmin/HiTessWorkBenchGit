import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition, Listbox } from '@headlessui/react';
import { X, UserPlus, Building, Briefcase, User, CheckCircle, ChevronDown, Check, Users, PenTool } from 'lucide-react';
import { register } from '../../api/auth';

// ==========================================
// [설정] 부서 목록 관리
// 1. 기본 부서 목록 (자동 정렬됨)
// 2. '기타' 옵션은 항상 맨 뒤에 붙음
// ==========================================
const BASE_DEPARTMENTS = [
  '구조시스템연구실',
  '선장설계부',
  '선체설계부',
  '기장설계부',
  '선각기술설계부',
  '미래기술개발부',
  '건조기술기획부',
  '운항관제부',
].sort(); // 가나다순 정렬

// '기타'를 맨 뒤에 추가
const DEPARTMENT_OPTIONS = [...BASE_DEPARTMENTS, '기타'];

export default function RegisterModal({ isOpen, onClose, initialEmployeeId }) {
  const [formData, setFormData] = useState({
    employee_id: '',
    name: '',
    company: 'HD 현대중공업',
    position: '책임엔지니어',
    department: DEPARTMENT_OPTIONS[0]
  });
  
  // [신규] '기타' 선택 시 직접 입력할 텍스트 저장용 상태
  const [customDept, setCustomDept] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const companyOptions = ['HD 현대중공업', 'HD 현대삼호', 'HD 한국조선해양', 'HD 현대미포'];
  const positionOptions = ['책임연구원', '책임엔지니어', '선임연구원', '선임엔지니어', '연구원', '엔지니어'];

  useEffect(() => {
    if (isOpen) {
      if (initialEmployeeId) {
        setFormData(prev => ({ ...prev, employee_id: initialEmployeeId }));
      }
      setIsSuccess(false);
      setErrorMsg('');
      setIsLoading(false);
      setCustomDept(''); // 모달 열릴 때 초기화
      setFormData(prev => ({ ...prev, department: DEPARTMENT_OPTIONS[0] })); // 부서 초기화
    }
  }, [isOpen, initialEmployeeId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // '기타' 입력창 핸들러
  const handleCustomDeptChange = (e) => {
    setCustomDept(e.target.value);
  };

  const handleSelectChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    // [중요] 전송 전 데이터 가공
    // '기타'가 선택되어 있다면 customDept 값을, 아니라면 선택된 값을 사용
    const finalDepartment = formData.department === '기타' ? customDept : formData.department;

    // 빈 값 체크 ('기타' 선택하고 내용 안 적었을 때)
    if (formData.department === '기타' && !customDept.trim()) {
        setErrorMsg("부서명을 직접 입력해 주세요.");
        setIsLoading(false);
        return;
    }

    const payload = {
        ...formData,
        department: finalDepartment
    };

    try {
      await register(payload);
      setIsSuccess(true);
    } catch (error) {
      console.error("Register Error:", error);
      if (error.response && error.response.status === 400) {
        setErrorMsg("이미 등록된 사번입니다.");
      } else {
        setErrorMsg("회원가입 중 오류가 발생했습니다.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsSuccess(false);
    onClose();
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 scale-95 translate-y-4" enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-200" leaveFrom="opacity-100 scale-100 translate-y-0" leaveTo="opacity-0 scale-95 translate-y-4"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-visible rounded-2xl bg-white text-left align-middle shadow-2xl transition-all border border-slate-100">
                
                {isSuccess ? (
                   <div className="p-8 text-center">
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100 mb-6 animate-bounce">
                        <CheckCircle className="h-10 w-10 text-green-600" />
                      </div>
                      <Dialog.Title as="h3" className="text-2xl font-bold text-slate-900 mb-2">가입 신청 완료</Dialog.Title>
                      <p className="text-sm text-slate-500 mb-6">관리자 승인 후 이용 가능합니다.</p>
                      <button onClick={handleClose} className="w-full py-3 bg-brand-green text-white font-bold rounded-xl">확인</button>
                   </div>
                ) : (
                  <>
                    <div className="bg-gradient-to-r from-brand-blue to-brand-blue-dark p-6 flex justify-between items-center text-white rounded-t-2xl">
                       <h3 className="text-lg font-bold">Hi-TESS Join</h3>
                       <button onClick={handleClose}><X size={20}/></button>
                    </div>

                    <div className="p-8 bg-slate-50 rounded-b-2xl">
                      <form onSubmit={handleSubmit} className="space-y-4">
                        {errorMsg && <div className="text-red-600 text-sm font-bold text-center animate-pulse">{errorMsg}</div>}
                        
                        {/* 사번 & 이름 */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                           <div>
                             <label className="text-xs font-bold text-slate-500">사번</label>
                             <input type="text" name="employee_id" value={formData.employee_id} onChange={handleChange} required className="w-full p-2 border rounded-lg bg-slate-50 outline-none focus:border-blue-500 transition-colors"/>
                           </div>
                           <div>
                             <label className="text-xs font-bold text-slate-500">이름</label>
                             <input type="text" name="name" value={formData.name} onChange={handleChange} required className="w-full p-2 border rounded-lg bg-slate-50 outline-none focus:border-blue-500 transition-colors"/>
                           </div>
                        </div>

                        {/* 선택 입력 */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                           <StyledListbox label="회사" value={formData.company} onChange={(v)=>handleSelectChange('company', v)} options={companyOptions} icon={Building} zIndex="z-30"/>
                           
                           {/* 부서 선택 */}
                           <div className="relative z-20">
                             <StyledListbox label="소속 부서" value={formData.department} onChange={(v)=>handleSelectChange('department', v)} options={DEPARTMENT_OPTIONS} icon={Users} zIndex="z-20"/>
                             
                             {/* [핵심] '기타' 선택 시 나타나는 입력 필드 */}
                             {formData.department === '기타' && (
                                <div className="mt-2 animate-fade-in-down">
                                   <label className="block text-xs font-bold text-blue-600 uppercase mb-1 ml-1 flex items-center gap-1">
                                     <PenTool size={12}/> 직접 입력
                                   </label>
                                   <input 
                                      type="text" 
                                      value={customDept}
                                      onChange={handleCustomDeptChange}
                                      placeholder="부서명을 입력하세요"
                                      className="w-full p-2 border-2 border-blue-100 rounded-lg bg-blue-50/50 outline-none focus:border-blue-500 focus:bg-white transition-all text-sm font-medium text-slate-700"
                                      autoFocus
                                   />
                                </div>
                             )}
                           </div>
                           
                           <StyledListbox label="직급" value={formData.position} onChange={(v)=>handleSelectChange('position', v)} options={positionOptions} icon={Briefcase} zIndex="z-10"/>
                        </div>

                        <button type="submit" disabled={isLoading} className="w-full py-3 bg-brand-green text-white font-bold rounded-xl hover:opacity-90 transition-colors shadow-lg transform active:scale-[0.98]">
                           {isLoading ? 'Processing...' : '가입 신청하기'}
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// (StyledListbox는 이전과 동일)
function StyledListbox({ label, value, onChange, options, icon: Icon, zIndex = "z-10" }) {
  return (
    <div className={`relative ${zIndex}`}>
      <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">{label}</label>
      <Listbox value={value} onChange={onChange}>
        <div className="relative mt-1">
          <Listbox.Button className="relative w-full cursor-pointer py-2 pl-10 pr-10 text-left bg-slate-50 border border-slate-200 rounded-lg focus:bg-white sm:text-sm shadow-sm hover:border-blue-300 transition-colors">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3"><Icon className="h-4 w-4 text-slate-400"/></span>
            <span className="block truncate text-slate-700 font-medium">{value}</span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-2"><ChevronDown className="h-4 w-4 text-slate-400"/></span>
          </Listbox.Button>
          <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
            <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-xl ring-1 ring-black/5 sm:text-sm">
              {options.map((option, idx) => (
                <Listbox.Option key={idx} value={option} className={({ active }) => `relative cursor-pointer select-none py-2 pl-10 pr-4 transition-colors ${active ? 'bg-green-50 text-green-900' : 'text-slate-900'}`}>
                  {({ selected }) => (
                    <>
                      <span className={`block truncate ${selected ? 'font-bold' : 'font-normal'}`}>{option}</span>
                      {selected && <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-green-600"><Check className="h-4 w-4"/></span>}
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
    </div>
  );
}