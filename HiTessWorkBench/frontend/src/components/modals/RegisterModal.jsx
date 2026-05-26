import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition, Listbox } from '@headlessui/react';
import {
  X, Building, Briefcase, CheckCircle, ChevronDown, Check, Users, PenTool,
  UserPlus, Fingerprint, AlertCircle, ArrowRight, Loader2, User,
} from 'lucide-react';
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

const BASE_COMPANIES = ['HD 현대중공업', 'HD 현대삼호', 'HD 한국조선해양'];
const BASE_POSITIONS = ['책임연구원', '책임엔지니어', '선임연구원', '선임엔지니어', '연구원', '엔지니어'];

// 직접 입력은 최상단에 고정 — 단, 회사는 HD 계열사 3개로 고정하므로 제외
const COMPANY_OPTIONS    = BASE_COMPANIES;
const DEPARTMENT_OPTIONS = [CUSTOM_LABEL, ...BASE_DEPARTMENTS];
const POSITION_OPTIONS   = [CUSTOM_LABEL, ...BASE_POSITIONS];
const EMPLOYEE_ID_PATTERN = /^A\d{6}$/;
const EMPLOYEE_ID_FORMAT_MESSAGE = '사번 형식이 올바르지 않습니다. A + 숫자 6자리 형식으로 다시 사번을 확인해 주세요.';

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
    const nextValue = name === 'employee_id' ? value.toUpperCase().trim() : value;
    setFormData(prev => ({ ...prev, [name]: nextValue }));
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
    setErrorMsg('');

    const employeeId = formData.employee_id.trim().toUpperCase();
    if (!EMPLOYEE_ID_PATTERN.test(employeeId)) {
      setErrorMsg(EMPLOYEE_ID_FORMAT_MESSAGE);
      return;
    }

    setIsLoading(true);

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
      employee_id: employeeId,
      department: finalDepartment,
      position: finalPosition,
    };

    try {
      await register(payload);
      setIsSuccess(true);
    } catch (error) {
      console.error("Register Error:", error);
      if (error.response?.status === 422 && error.response?.data?.detail === 'invalid_employee_id_format') {
        setErrorMsg(EMPLOYEE_ID_FORMAT_MESSAGE);
      } else if (error.response && error.response.status === 400) {
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

  // 사번 실시간 형식 피드백 (값이 7자에 도달했을 때만 invalid 표시 — 입력 중에는 깜빡임 방지)
  const employeeIdLength = formData.employee_id.length;
  const isEmployeeIdValid = EMPLOYEE_ID_PATTERN.test(formData.employee_id);
  const showEmployeeIdValid = employeeIdLength > 0 && isEmployeeIdValid;
  const showEmployeeIdInvalid = employeeIdLength >= 7 && !isEmployeeIdValid;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-xl" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-start sm:items-center justify-center p-2 sm:p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 scale-95 translate-y-4" enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-200" leaveFrom="opacity-100 scale-100 translate-y-0" leaveTo="opacity-0 scale-95 translate-y-4"
            >
              <Dialog.Panel className="w-full max-w-lg transform overflow-visible rounded-2xl bg-white/95 backdrop-blur-xl text-left align-middle shadow-[0_25px_70px_-15px_rgba(0,37,84,0.45)] ring-1 ring-slate-900/5 border border-white/40 my-2">

                {isSuccess ? (
                  <div className="p-10 text-center rounded-2xl bg-white">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-green-200 mb-6 ring-4 ring-green-50 animate-bounce">
                      <CheckCircle className="h-12 w-12 text-emerald-600" />
                    </div>
                    <Dialog.Title as="h3" className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">가입 신청 완료</Dialog.Title>
                    <p className="text-sm text-slate-500 mb-8">관리자 승인 후 이용 가능합니다.</p>
                    <button
                      onClick={handleClose}
                      className="group w-full inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-brand-green to-emerald-600 hover:from-emerald-600 hover:to-brand-green text-white font-bold rounded-xl shadow-lg shadow-brand-green/25 hover:shadow-xl hover:shadow-brand-green/35 transition-all"
                    >
                      <span>확인</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </button>
                  </div>
                ) : (
                  <>
                    {/* ── 헤더 ── */}
                    <div className="relative overflow-hidden rounded-t-2xl bg-gradient-to-br from-brand-blue via-brand-blue-dark to-brand-blue-light px-6 py-5 text-white">
                      {/* 장식 블롭 */}
                      <div className="pointer-events-none absolute -top-12 -right-10 h-40 w-40 rounded-full bg-brand-accent/20 blur-3xl" />
                      <div className="pointer-events-none absolute -bottom-16 right-20 h-32 w-32 rounded-full bg-blue-400/20 blur-2xl" />

                      <div className="relative flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
                            <UserPlus className="h-6 w-6 text-white" />
                          </div>
                          <div className="text-left">
                            <h3 className="text-xl font-bold tracking-tight leading-tight">Hi-TESS Workbench 가입</h3>
                            <p className="text-xs text-white/70 mt-0.5">관리자 승인 후 즉시 이용 가능합니다.</p>
                          </div>
                        </div>
                        <button
                          onClick={handleClose}
                          className="rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors"
                          aria-label="닫기"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    </div>

                    {/* ── 폼 본문 ── */}
                    <div className="p-5 sm:p-7 bg-slate-50/60 rounded-b-2xl">
                      <form onSubmit={handleSubmit} className="space-y-4">

                        {errorMsg && (
                          <div role="alert" className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm animate-fade-in">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                            <span className="font-medium text-left">{errorMsg}</span>
                          </div>
                        )}

                        {/* 계정 정보 섹션 */}
                        <section className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="block h-3.5 w-1 rounded-full bg-brand-green" />
                            <h4 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">계정 정보</h4>
                          </div>

                          <div className="space-y-3">
                            {/* 사번 */}
                            <div>
                              <label className="block text-xs font-bold text-slate-600 uppercase mb-1 ml-1">사번</label>
                              <div className="relative">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                  <Fingerprint className="h-4 w-4 text-brand-blue/70" />
                                </span>
                                <input
                                  type="text"
                                  name="employee_id"
                                  value={formData.employee_id}
                                  onChange={handleChange}
                                  required
                                  maxLength={7}
                                  placeholder="A123456"
                                  className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-lg outline-none placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition-all"
                                />
                                {showEmployeeIdValid && (
                                  <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                                    <Check className="h-4 w-4 text-emerald-600" />
                                  </span>
                                )}
                                {showEmployeeIdInvalid && (
                                  <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                                    <AlertCircle className="h-4 w-4 text-red-500" />
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500 font-medium ml-1">형식: A + 숫자 6자리</p>
                            </div>

                            {/* 이름 */}
                            <div>
                              <label className="block text-xs font-bold text-slate-600 uppercase mb-1 ml-1">이름</label>
                              <div className="relative">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                  <User className="h-4 w-4 text-brand-blue/70" />
                                </span>
                                <input
                                  type="text"
                                  name="name"
                                  value={formData.name}
                                  onChange={handleChange}
                                  required
                                  placeholder="홍길동"
                                  className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg outline-none placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 transition-all"
                                />
                              </div>
                            </div>
                          </div>
                        </section>

                        {/* 소속 정보 섹션 */}
                        <section className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="block h-3.5 w-1 rounded-full bg-brand-blue" />
                            <h4 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">소속 정보</h4>
                          </div>

                          <div className="space-y-4">
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
                        </section>

                        {/* 제출 버튼 */}
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="group w-full inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-brand-green to-emerald-600 hover:from-emerald-600 hover:to-brand-green text-white font-bold rounded-xl shadow-lg shadow-brand-green/25 hover:shadow-xl hover:shadow-brand-green/35 transition-all transform active:scale-[0.98] disabled:from-slate-400 disabled:to-slate-400 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>처리 중...</span>
                            </>
                          ) : (
                            <>
                              <span>가입 신청하기</span>
                              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </>
                          )}
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
          <label className="block text-xs font-bold text-brand-blue uppercase mb-1 ml-1 flex items-center gap-1">
            <PenTool size={12}/> 직접 입력
          </label>
          <input
            type="text"
            value={customValue}
            onChange={(e) => onCustomChange(field, e.target.value)}
            placeholder={placeholder}
            className="w-full p-2.5 border-2 border-brand-blue/15 rounded-lg bg-brand-blue/[0.03] outline-none focus:border-brand-blue focus:bg-white transition-all text-sm font-medium text-slate-700"
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
      <label className="block text-xs font-bold text-slate-600 uppercase mb-1 ml-1">{label}</label>
      <Listbox value={value} onChange={onChange}>
        <div className="relative mt-1">
          <Listbox.Button className="relative w-full cursor-pointer py-2.5 pl-10 pr-10 text-left bg-white border border-slate-200 rounded-lg hover:border-brand-blue/40 focus:outline-none focus:ring-2 focus:ring-brand-blue/15 focus:border-brand-blue sm:text-sm shadow-sm transition-all">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3"><Icon className="h-4 w-4 text-brand-blue/70"/></span>
            <span className="block truncate text-slate-700 font-medium">{value}</span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-2"><ChevronDown className="h-4 w-4 text-slate-400"/></span>
          </Listbox.Button>
          <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
            <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-base shadow-2xl ring-1 ring-slate-900/5 sm:text-sm z-10">
              {options.map((option, idx) => {
                const isCustomOption = option === CUSTOM_LABEL;
                return (
                  <Listbox.Option
                    key={idx}
                    value={option}
                    className={({ active }) =>
                      `relative cursor-pointer select-none py-2 pl-10 pr-4 transition-colors ${
                        active ? 'bg-brand-blue/5 text-brand-blue' : 'text-slate-900'
                      } ${isCustomOption ? 'border-b border-slate-200 bg-brand-blue/5 font-bold text-brand-blue' : ''}`
                    }
                  >
                    {({ selected }) => (
                      <>
                        <span className={`block truncate ${selected ? 'font-bold' : 'font-normal'}`}>{option}</span>
                        {selected && <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-brand-blue"><Check className="h-4 w-4"/></span>}
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
