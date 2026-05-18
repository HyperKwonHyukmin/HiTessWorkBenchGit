import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition, Listbox } from '@headlessui/react';
import { X, Building, Briefcase, CheckCircle, ChevronDown, Check, Users, PenTool } from 'lucide-react';
import { register } from '../../api/auth';

// ==========================================
// [설정] 콤보 옵션 — 각 옵션 배열의 맨 앞에 '직접 입력' 항목을 두어
// 목록에 없는 값을 사용자가 직접 입력할 수 있도록 한다.
// ==========================================
const CUSTOM_LABEL = '✏️ 직접 입력';

const BASE_DEPARTMENTS = [
  '구조시스템연구실',
  '선장설계부',
  '선체설계부',
  '기장설계부',
  '선각기술설계부',
  '미래기술개발부',
  '건조기술기획부',
  '운항관제부',
].sort();

const BASE_COMPANIES = ['HD 현대중공업', 'HD 현대삼호', 'HD 한국조선해양', 'HD 현대미포'];
const BASE_POSITIONS = ['책임연구원', '책임엔지니어', '선임연구원', '선임엔지니어', '연구원', '엔지니어'];

// 직접 입력은 최상단에 고정 — 단, 회사는 HD 계열사 4개로 고정하므로 제외
const COMPANY_OPTIONS    = BASE_COMPANIES;
const DEPARTMENT_OPTIONS = [CUSTOM_LABEL, ...BASE_DEPARTMENTS];
const POSITION_OPTIONS   = [CUSTOM_LABEL, ...BASE_POSITIONS];

export default function RegisterModal({ isOpen, onClose, initialEmployeeId }) {
  const [formData, setFormData] = useState({
    employee_id: '',
    name: '',
    company: 'HD 현대중공업',
    position: '책임엔지니어',
    department: BASE_DEPARTMENTS[0],
  });

  // 직접 입력 선택 시 사용자가 타이핑한 텍스트 — 필드별 별도 보관 (회사는 고정 옵션이라 제외)
  const [customValues, setCustomValues] = useState({ department: '', position: '' });

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialEmployeeId) {
        setFormData(prev => ({ ...prev, employee_id: initialEmployeeId }));
      }
      setIsSuccess(false);
      setErrorMsg('');
      setIsLoading(false);
      setCustomValues({ department: '', position: '' });
    }
  }, [isOpen, initialEmployeeId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    // 직접 입력에서 다른 옵션으로 바꾸면 해당 필드의 custom 값 초기화
    if (value !== CUSTOM_LABEL) {
      setCustomValues(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleCustomChange = (name, value) => {
    setCustomValues(prev => ({ ...prev, [name]: value }));
  };

  // 직접 입력 선택 시 customValues 값을, 아니라면 선택된 옵션 값을 사용
  const resolveValue = (field) =>
    formData[field] === CUSTOM_LABEL ? customValues[field].trim() : formData[field];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    const finalDepartment = resolveValue('department');
    const finalPosition   = resolveValue('position');

    // 직접 입력을 선택하고 비워둔 경우 차단 (회사는 고정 옵션이라 검증 불필요)
    const missing = [];
    if (formData.department === CUSTOM_LABEL && !finalDepartment) missing.push('부서명');
    if (formData.position   === CUSTOM_LABEL && !finalPosition)   missing.push('직급');

    if (missing.length > 0) {
      setErrorMsg(`${missing.join(', ')}을(를) 직접 입력해 주세요.`);
      setIsLoading(false);
      return;
    }

    const payload = {
      ...formData,
      department: finalDepartment,
      position: finalPosition,
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
          <div className="flex min-h-full items-start sm:items-center justify-center p-2 sm:p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 scale-95 translate-y-4" enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-200" leaveFrom="opacity-100 scale-100 translate-y-0" leaveTo="opacity-0 scale-95 translate-y-4"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-visible rounded-2xl bg-white text-left align-middle shadow-2xl transition-all border border-slate-100 my-2">

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
                    <div className="bg-gradient-to-r from-brand-blue to-brand-blue-dark px-6 py-4 sm:py-5 flex justify-between items-center text-white rounded-t-2xl">
                      <h3 className="text-lg font-bold">Hi-TESS Join</h3>
                      <button onClick={handleClose}><X size={20}/></button>
                    </div>

                    <div className="p-5 sm:p-8 bg-slate-50 rounded-b-2xl">
                      <form onSubmit={handleSubmit} className="space-y-4">
                        {errorMsg && <div className="text-red-600 text-sm font-bold text-center animate-pulse">{errorMsg}</div>}

                        {/* 사번 & 이름 */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                          <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1 ml-1">사번</label>
                            <input type="text" name="employee_id" value={formData.employee_id} onChange={handleChange} required className="w-full p-2 border rounded-lg bg-slate-50 outline-none focus:border-blue-500 transition-colors"/>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1 ml-1">이름</label>
                            <input type="text" name="name" value={formData.name} onChange={handleChange} required className="w-full p-2 border rounded-lg bg-slate-50 outline-none focus:border-blue-500 transition-colors"/>
                          </div>
                        </div>

                        {/* 소속 선택 — 부서 / 직급은 '직접 입력' 옵션 지원, 회사는 HD 계열사 고정 */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                          <div className="relative z-30">
                            <StyledListbox
                              label="회사"
                              value={formData.company}
                              onChange={(v) => handleSelectChange('company', v)}
                              options={COMPANY_OPTIONS}
                              icon={Building}
                            />
                          </div>
                          <SelectWithCustom
                            label="소속 부서"
                            field="department"
                            icon={Users}
                            zIndex="z-20"
                            options={DEPARTMENT_OPTIONS}
                            value={formData.department}
                            onChange={handleSelectChange}
                            customValue={customValues.department}
                            onCustomChange={handleCustomChange}
                            placeholder="부서명을 입력하세요"
                          />
                          <SelectWithCustom
                            label="직급"
                            field="position"
                            icon={Briefcase}
                            zIndex="z-10"
                            options={POSITION_OPTIONS}
                            value={formData.position}
                            onChange={handleSelectChange}
                            customValue={customValues.position}
                            onCustomChange={handleCustomChange}
                            placeholder="직급을 입력하세요"
                          />
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

// 콤보박스 + (CUSTOM_LABEL 선택 시) 직접 입력 필드 묶음.
function SelectWithCustom({
  label, field, icon, zIndex,
  options, value, onChange,
  customValue, onCustomChange, placeholder,
}) {
  const isCustom = value === CUSTOM_LABEL;
  return (
    <div className={`relative ${zIndex}`}>
      <StyledListbox
        label={label}
        value={value}
        onChange={(v) => onChange(field, v)}
        options={options}
        icon={icon}
      />
      {isCustom && (
        <div className="mt-2 animate-fade-in-down">
          <label className="block text-xs font-bold text-blue-600 uppercase mb-1 ml-1 flex items-center gap-1">
            <PenTool size={12}/> 직접 입력
          </label>
          <input
            type="text"
            value={customValue}
            onChange={(e) => onCustomChange(field, e.target.value)}
            placeholder={placeholder}
            className="w-full p-2 border-2 border-blue-100 rounded-lg bg-blue-50/50 outline-none focus:border-blue-500 focus:bg-white transition-all text-sm font-medium text-slate-700"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

function StyledListbox({ label, value, onChange, options, icon: Icon }) {
  return (
    <div>
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
              {options.map((option, idx) => {
                const isCustomOption = option === CUSTOM_LABEL;
                return (
                  <Listbox.Option
                    key={idx}
                    value={option}
                    className={({ active }) =>
                      `relative cursor-pointer select-none py-2 pl-10 pr-4 transition-colors ${
                        active ? 'bg-blue-50 text-blue-900' : 'text-slate-900'
                      } ${isCustomOption ? 'border-b border-slate-200 bg-blue-50/30 font-bold text-blue-700' : ''}`
                    }
                  >
                    {({ selected }) => (
                      <>
                        <span className={`block truncate ${selected ? 'font-bold' : 'font-normal'}`}>{option}</span>
                        {selected && <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600"><Check className="h-4 w-4"/></span>}
                      </>
                    )}
                  </Listbox.Option>
                );
              })}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
    </div>
  );
}
