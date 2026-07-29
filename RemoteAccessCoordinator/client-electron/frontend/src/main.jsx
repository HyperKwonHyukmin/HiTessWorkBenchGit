import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, Clock3, LogIn, MessageSquare, MonitorDot, RefreshCw, Send, ShieldCheck, Users, WifiOff } from 'lucide-react';
import './styles.css';

const BASE_URL = 'http://10.14.42.145:8765';
const request = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.json();
};

// 서버에서 받은 메시지를 로컬 목록에 합친다. 내가 낙관적으로 먼저 그려둔 pending 말풍선이
// 있으면(같은 발신·수신·내용) 실제 메시지로 교체해 중복을 막는다. 임시 id는 음수라 서버(양수)와 안 겹침.
function mergeIncoming(items, incoming) {
  const knownIds = new Set(items.filter(message => message.id > 0).map(message => message.id));
  let next = items;
  for (const message of incoming) {
    if (knownIds.has(message.id)) continue;
    const pendingIndex = next.findIndex(item => item.pending && item.from_ip === message.from_ip && item.to_ip === message.to_ip && item.text === message.text);
    next = pendingIndex >= 0
      ? next.map((item, index) => (index === pendingIndex ? { ...message } : item))
      : [...next, message];
    knownIds.add(message.id);
  }
  return next;
}

function App() {
  const [clientIp, setClientIp] = useState('확인 중');
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedIp, setSelectedIp] = useState(null);
  const [draft, setDraft] = useState('');
  const [statusText, setStatusText] = useState('');
  const [expected, setExpected] = useState('');
  const [connection, setConnection] = useState({ ok: false, text: '서버에 연결 중' });
  const lastMessageId = useRef(0);
  const statusInFlight = useRef(false);
  const messagesInFlight = useRef(false);
  const messagesInitialized = useRef(false);
  const tempIdRef = useRef(0);
  const chatLogRef = useRef(null);
  const composerRef = useRef(null);
  const nameCacheRef = useRef({});

  // 세션 상태 조회 — 서버가 매 호출 qwinsta/PowerShell로 RDP 세션을 스캔하는 '무거운' 요청.
  const pollStatus = async () => {
    if (statusInFlight.current) return;
    statusInFlight.current = true;
    try {
      const status = await request('/api/status');
      setSessions(status.sessions);
      setConnection({ ok: true, text: '실시간 연결됨' });
    } catch (error) { setConnection({ ok: false, text: `연결 실패 · ${error.message}` }); }
    finally { statusInFlight.current = false; }
  };

  // 메시지 조회 — 서버 인메모리에서 바로 거르는 '가벼운' 요청이라 상태 조회와 분리해
  // 더 짧은 주기로 돌려 수신 반영을 빠르게 한다.
  const pollMessages = async () => {
    if (clientIp === '확인 중' || messagesInFlight.current) return;
    messagesInFlight.current = true;
    try {
      const inbox = await request(`/api/messages?client_ip=${encodeURIComponent(clientIp)}&after_id=${lastMessageId.current}`);
      const firstFetch = !messagesInitialized.current;
      messagesInitialized.current = true;
      if (inbox.messages.length) {
        // 최초 조회분은 과거 기록이라 알리지 않고, 이후 도착한 수신 메시지만 즉시 알린다.
        if (!firstFetch) {
          const incoming = inbox.messages.filter(message => message.to_ip === clientIp && message.from_ip !== clientIp);
          if (incoming.length) notifyIncoming(incoming);
        }
        lastMessageId.current = Math.max(lastMessageId.current, ...inbox.messages.map(message => message.id));
        setMessages(items => mergeIncoming(items, inbox.messages));
      }
    } catch (_) { /* 연결 오류 표시는 상태 폴링이 대표로 담당 */ }
    finally { messagesInFlight.current = false; }
  };

  const refreshAll = () => { pollStatus(); pollMessages(); };

  useEffect(() => {
    const findLocalIp = window.rdpDesk?.localIp || (async () => '브라우저 미리보기');
    findLocalIp().then(setClientIp).catch(() => setClientIp('확인 불가'));
  }, []);
  useEffect(() => { pollStatus(); const timer = setInterval(pollStatus, 3000); return () => clearInterval(timer); }, []);
  useEffect(() => { pollMessages(); const timer = setInterval(pollMessages, 1200); return () => clearInterval(timer); }, [clientIp]);

  // 대화 상대 자동 선택. 이미 '자기 자신이 아닌' 유효한 상대를 보고 있으면 그대로 유지하고,
  // 아직 아무도(또는 자기 자신만) 선택되지 않았다면 가장 최근 메시지 상대를 연다.
  // ★ 핵심 수정: 내가 RDP 작업자일 때 나에게 말을 건 사람은 '현재 원격 사용자'(RDP 세션) 목록에
  //   없지만, 여기서 최근 메시지 상대로 자동 선택되어 대화가 화면에 보이게 된다.
  //   (과거엔 유일 세션인 '자기 자신'만 선택돼, 수신 메시지가 토스트만 뜨고 대화창엔 안 보였음.)
  useEffect(() => {
    if (selectedIp && selectedIp !== clientIp) return;
    const last = messages[messages.length - 1];
    const lastPartner = last ? (last.from_ip === clientIp ? last.to_ip : last.from_ip) : null;
    const otherSession = sessions.find(session => session.ip_address && session.ip_address !== clientIp)?.ip_address || null;
    const next = (lastPartner && lastPartner !== clientIp ? lastPartner : null) || otherSession || null;
    if (next && next !== selectedIp) setSelectedIp(next);
  }, [messages, sessions, selectedIp, clientIp]);

  // 한 번이라도 목록에 나타난 사용자의 이름은 캐시해 둔다 — 연결이 끊겨 목록에서
  // 빠지더라도 IP 대신 이름으로 계속 표시하기 위함.
  useEffect(() => {
    sessions.forEach(session => {
      if (session.ip_address && session.display_name) nameCacheRef.current[session.ip_address] = session.display_name;
    });
  }, [sessions]);

  const ownSession = useMemo(() => sessions.find(session => session.ip_address === clientIp), [sessions, clientIp]);
  const selected = sessions.find(session => session.ip_address === selectedIp);
  const nameFor = ip => nameCacheRef.current[ip] || sessions.find(session => session.ip_address === ip)?.display_name || ip;
  // 현재 RDP 세션 목록엔 없지만 메시지를 주고받은 상대(미접속) — 대화 목록에 별도로 노출한다.
  const sessionIpSet = useMemo(() => new Set(sessions.map(session => session.ip_address).filter(Boolean)), [sessions]);
  const offlinePartnerIps = useMemo(() => {
    const order = [];
    for (const message of messages) {
      const other = message.from_ip === clientIp ? message.to_ip : message.from_ip;
      if (other && other !== clientIp && !sessionIpSet.has(other) && !order.includes(other)) order.push(other);
    }
    return order;
  }, [messages, clientIp, sessionIpSet]);
  const conversationMessages = useMemo(() => messages.filter(message => (
    selectedIp && (
      (message.from_ip === clientIp && message.to_ip === selectedIp) ||
      (message.from_ip === selectedIp && message.to_ip === clientIp)
    )
  )), [messages, clientIp, selectedIp]);

  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  }, [conversationMessages, selectedIp]);

  // 대화 상대를 클릭해서 바꿀 때는 바로 입력할 수 있도록 포커스를 옮겨준다.
  useEffect(() => {
    if (selectedIp) composerRef.current?.focus();
  }, [selectedIp]);

  // 대화 상대 상태 계산 — server.py의 send_message 인가 규칙과 그대로 맞춘다:
  //  · to_ip가 현재 세션 목록에 있으면 채팅/사용요청 모두 가능
  //  · 목록에 없어도, 내가 현재 접속 중이고(from_ip 활성) 이전에 나눈 대화가 있으면 답장은 가능
  //  · 원격 사용 요청(access_request)은 상대가 지금 접속해 있을 때만 가능
  const isSelfSelected = Boolean(selectedIp) && selectedIp === clientIp;
  const partnerActive = Boolean(selected);
  const partnerGone = Boolean(selectedIp) && !isSelfSelected && !partnerActive;
  const hasHistory = conversationMessages.length > 0;
  const partnerName = selectedIp ? nameFor(selectedIp) : null;
  const canSendChat = Boolean(selectedIp) && !isSelfSelected && (partnerActive || (Boolean(ownSession) && hasHistory));
  const canSendAccessRequest = Boolean(selectedIp) && !isSelfSelected && partnerActive;

  const partnerStatus = !selectedIp
    ? { cls: 'none', label: '대화 상대 없음' }
    : isSelfSelected
      ? { cls: 'self', label: '본인 세션' }
      : partnerGone
        ? { cls: 'offline', label: '연결 종료됨' }
        : selected.is_active
          ? { cls: 'online', label: '작업 중' }
          : { cls: 'idle', label: '연결 끊김' };

  const composerPlaceholder = !selectedIp
    ? '대화 상대를 선택하세요'
    : isSelfSelected
      ? '본인에게는 메시지를 보낼 수 없습니다'
      : canSendChat
        ? '메시지를 입력하세요 (Enter로 전송)'
        : '상대가 접속하지 않아 메시지를 보낼 수 없습니다';

  const chatEmpty = isSelfSelected
    ? { icon: <ShieldCheck size={26} />, title: '본인 세션입니다', body: '다른 사용자를 선택하면 대화를 시작할 수 있습니다.' }
    : !selectedIp
      ? { icon: <Users size={26} />, title: '대화 상대를 선택하세요', body: '왼쪽 목록에서 사용자를 클릭하면 대화가 시작됩니다.' }
      : partnerGone
        ? {
            icon: <WifiOff size={26} />,
            title: `${partnerName} 님이 연결을 종료했습니다`,
            body: canSendChat ? '메시지를 보내면 상대가 다시 접속했을 때 확인할 수 있습니다.' : '상대가 다시 접속하면 메시지를 보낼 수 있습니다.',
          }
        : { icon: <MessageSquare size={26} />, title: `${partnerName}와의 대화`, body: '첫 메시지를 보내 대화를 시작하세요.' };

  function selectConversation(ip) {
    if (!ip || ip === clientIp) return;
    setSelectedIp(ip);
    setDraft('');
  }

  // 새로 도착한 수신 메시지를 네이티브 토스트로 즉시 알린다(트레이 상주 중에도 인지 가능).
  function notifyIncoming(incoming) {
    const last = incoming[incoming.length - 1];
    const senderName = nameFor(last.from_ip);
    const isRequest = last.kind === 'access_request';
    const title = incoming.length > 1
      ? `새 메시지 ${incoming.length}건`
      : isRequest ? `${senderName} 님의 원격 사용 요청` : `${senderName} 님의 메시지`;
    const body = incoming.length > 1 ? `${senderName}: ${last.text}` : last.text;
    window.rdpDesk?.notify?.({ title, body });
  }

  async function saveStatus() {
    try {
      await request('/api/status', { method: 'POST', body: JSON.stringify({ client_ip: clientIp, message: statusText, expected_minutes: expected ? Number(expected) : null }) });
      pollStatus();
    } catch (error) { setConnection({ ok: false, text: `상태 저장 실패 · ${error.message}` }); }
  }

  // 낙관적 UI — 서버 응답을 기다리지 않고 즉시 말풍선을 그리고 입력창을 비운다(메신저처럼 반응 즉각).
  // 전송은 백그라운드로 진행하고, 성공하면 실제 메시지로 교체, 실패하면 '전송 실패'로 표시한다.
  async function send(kind = 'chat') {
    const text = draft.trim() || (kind === 'access_request' ? '원격 사용해도 될까요?' : '');
    if (!selectedIp || !text || isSelfSelected) return false;
    if (kind === 'chat' && !canSendChat) return false;
    if (kind === 'access_request' && !canSendAccessRequest) return false;
    const to = selectedIp;
    const tempId = (tempIdRef.current -= 1); // 음수 임시 id(서버 양수 id와 충돌 방지)
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const localStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    setMessages(items => [...items, { id: tempId, from_ip: clientIp, to_ip: to, text, kind, sent_at: localStamp, pending: true }]);
    setDraft('');
    composerRef.current?.focus();
    try {
      const result = await request('/api/messages', { method: 'POST', body: JSON.stringify({ from_ip: clientIp, to_ip: to, text, kind }) });
      const real = result.message;
      if (real) lastMessageId.current = Math.max(lastMessageId.current, real.id);
      setMessages(items => items.map(item => (item.id === tempId ? { ...(real || item), pending: false } : item)));
      return true;
    } catch (error) {
      setMessages(items => items.map(item => (item.id === tempId ? { ...item, pending: false, failed: true } : item)));
      setConnection({ ok: false, text: `메시지 전송 실패 · ${error.message}` });
      return false;
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter') return;
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return; // IME 한글 조합 중 엔터는 무시(오전송 방지)
    event.preventDefault();
    send();
  }

  async function connectRdp(afterRequest = false) {
    if (afterRequest && !(await send('access_request'))) return;
    if (!window.rdpDesk?.connect) {
      setConnection({ ok: false, text: 'Electron 클라이언트에서만 원격 연결을 실행할 수 있습니다.' });
      return;
    }
    const result = await window.rdpDesk.connect();
    if (!result.ok) setConnection({ ok: false, text: `원격 연결 시작 실패 · ${result.error}` });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><MonitorDot size={22} /></span><span>RDP<br /><strong>ACCESS DESK</strong></span></div>
      <div className="nav-label">LIVE CONTROL</div>
      <div className="nav-active"><Users size={18} /> 접속 현황 <span>{sessions.length}</span></div>
      <div className="sidebar-bottom"><ShieldCheck size={18} /><div><b>사내망 전용</b><small>10.14.42.145</small></div></div>
    </aside>
    <main className="workspace">
      <header>
        <div><p className="eyebrow">REMOTE DESKTOP COORDINATION</p><h1>원격 접속 현황</h1><p className="subtitle">접속 전 현재 작업자에게 메시지를 보내고, 작업 상태를 확인하세요.</p></div>
        <div className="header-actions">
          <button type="button" className="connect-now" onClick={() => connectRdp()} aria-label="원격 데스크톱 연결"><LogIn size={17} /> 원격 연결</button>
          <button type="button" className="refresh" onClick={refreshAll} aria-label="새로고침"><RefreshCw size={17} /> 새로고침</button>
        </div>
      </header>
      <section className="summary-grid">
        <div className="metric"><span className="metric-icon blue"><Users size={20} /></span><div><small>현재 RDP 세션</small><b>{sessions.length}<em>명</em></b></div></div>
        <div className="metric"><span className={`metric-icon ${connection.ok ? 'green' : 'amber'}`}><Bell size={20} /></span><div><small>서버 상태</small><b className="metric-text">{connection.ok ? '정상 연결' : '확인 필요'}</b></div></div>
        <div className="metric"><span className="metric-icon slate"><MonitorDot size={20} /></span><div><small>내 PC IP</small><b className="ip-value">{clientIp}</b></div></div>
      </section>
      <div className="connection" role="status"><span className={connection.ok ? 'pulse ok' : 'pulse'}></span>{connection.text}</div>
      <section className="content-grid">
        <div className="panel sessions-panel">
          <div className="panel-head">
            <div><h2>현재 원격 사용자</h2><p>클릭하면 해당 사용자와 대화를 시작합니다.</p></div>
            <span className="live"><i /> LIVE</span>
          </div>
          <div className="table-head"><span>사용자</span><span>세션 상태</span><span>접속 경과</span><span>작업 상태</span></div>
          <div className="session-list">
            {sessions.length === 0 && offlinePartnerIps.length === 0 ? (
              <div className="empty"><Users size={22} /><span>현재 원격 접속자가 없습니다.</span></div>
            ) : (
              <>
                {sessions.map(session => {
                  const isOwn = session.ip_address === clientIp;
                  const isSelected = !isOwn && selectedIp === session.ip_address;
                  return (
                    <button
                      type="button"
                      key={session.session_id}
                      className={`session-row ${isSelected ? 'selected' : ''} ${isOwn ? 'own-row' : ''}`}
                      onClick={() => selectConversation(session.ip_address)}
                      aria-pressed={isSelected}
                      aria-disabled={isOwn}
                      title={isOwn ? '본인 세션입니다' : `${session.display_name}와 대화하기`}
                    >
                      <span className="person">
                        <span className="avatar">{session.display_name.slice(0, 1)}</span>
                        <span><b>{session.display_name}{isOwn && <mark>나</mark>}</b><small>{session.ip_address || 'IP 확인 중'}</small></span>
                      </span>
                      <span><i className={session.is_active ? 'state-dot active' : 'state-dot'} />{session.is_active ? '작업 중' : '연결 끊김'}</span>
                      <span className="duration"><Clock3 size={15} />{session.connected_duration}</span>
                      <span className="work-note">{session.status?.message || '상태 메시지 없음'}{session.status?.expected_minutes && <small> 약 {session.status.expected_minutes}분</small>}</span>
                    </button>
                  );
                })}
                {offlinePartnerIps.length > 0 && <div className="partner-divider">메시지 대화 · 현재 미접속</div>}
                {offlinePartnerIps.map(ip => {
                  const isSelected = selectedIp === ip;
                  const name = nameFor(ip);
                  return (
                    <button
                      type="button"
                      key={`msg-${ip}`}
                      className={`session-row offline-partner ${isSelected ? 'selected' : ''}`}
                      onClick={() => selectConversation(ip)}
                      aria-pressed={isSelected}
                      title={`${name}와 대화하기`}
                    >
                      <span className="person">
                        <span className="avatar">{name.slice(0, 1)}</span>
                        <span><b>{name}</b><small>{ip}</small></span>
                      </span>
                      <span><i className="state-dot" />미접속</span>
                      <span className="duration">–</span>
                      <span className="work-note">메시지 대화</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
        <div className="right-stack">
          <section className="panel my-status">
            <div className="panel-head">
              <div><h2>내 작업 상태</h2><p>{ownSession ? '현재 원격 사용자로 표시 중입니다.' : 'RDP 접속 후 상태를 등록할 수 있습니다.'}</p></div>
              <span className={ownSession ? 'badge active-badge' : 'badge'}>{ownSession ? '접속 중' : '대기'}</span>
            </div>
            <input value={statusText} onChange={event => setStatusText(event.target.value)} placeholder="예: 20분간 작업 예정" disabled={!ownSession} aria-label="작업 상태 메시지" />
            <div className="status-action">
              <input className="minutes" value={expected} onChange={event => setExpected(event.target.value.replace(/\D/g, ''))} placeholder="분" disabled={!ownSession} aria-label="예상 소요 시간(분)" />
              <button type="button" className="primary" onClick={saveStatus} disabled={!ownSession}>상태 공유</button>
            </div>
          </section>
          <section className="panel chat">
            <div className="panel-head chat-head">
              <h2><MessageSquare size={17} /> 대화</h2>
              <div className={`chat-partner ${isSelfSelected ? 'self' : ''} ${partnerGone ? 'gone' : ''}`}>
                <span className="avatar avatar-lg">{partnerName ? partnerName.slice(0, 1) : <Users size={16} />}</span>
                <div className="chat-partner-info">
                  <b>{partnerName || '선택된 상대 없음'}</b>
                  <span className={`partner-status ${partnerStatus.cls}`}><i />{partnerStatus.label}</span>
                </div>
              </div>
            </div>
            <div className="chat-log" ref={chatLogRef} aria-live="polite" aria-label="대화 내용">
              {conversationMessages.length === 0 ? (
                <div className="chat-empty">
                  <span className="chat-empty-icon">{chatEmpty.icon}</span>
                  <b>{chatEmpty.title}</b>
                  <p>{chatEmpty.body}</p>
                </div>
              ) : conversationMessages.map(message => {
                const mine = message.from_ip === clientIp;
                const isRequest = message.kind === 'access_request';
                const senderName = mine ? '나' : nameFor(message.from_ip);
                return (
                  <div className={`msg-row ${mine ? 'mine' : ''}`} key={message.id}>
                    <span className="avatar msg-avatar">{senderName.slice(0, 1)}</span>
                    <div className="msg-col">
                      <div className="msg-meta"><b>{senderName}</b><span className={message.failed ? 'meta-failed' : ''}>{message.failed ? '전송 실패' : message.pending ? '전송 중…' : message.sent_at.slice(11, 16)}</span></div>
                      <div className={`bubble ${mine ? 'mine' : ''} ${isRequest ? 'request' : ''} ${message.pending ? 'pending' : ''} ${message.failed ? 'failed' : ''}`}>
                        {isRequest && <span className="request-chip"><Bell size={11} /> 원격 사용 요청</span>}
                        {message.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="chat-actions">
              <div className="request-row">
                <button type="button" className="request" onClick={() => send('access_request')} disabled={!canSendAccessRequest} aria-label="원격 사용 요청 보내기">사용 요청</button>
                <button type="button" className="request connect-request" onClick={() => connectRdp(true)} disabled={!canSendAccessRequest} aria-label="사용 요청 후 원격 연결"><LogIn size={15} /> 요청 후 연결</button>
              </div>
              {selectedIp && !isSelfSelected && !canSendAccessRequest && (
                <p className="chat-hint">상대가 RDP에 접속 중일 때만 사용 요청을 보낼 수 있습니다.</p>
              )}
              <div className="composer">
                <input
                  ref={composerRef}
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={composerPlaceholder}
                  disabled={!canSendChat}
                  aria-label="메시지 입력"
                />
                <button type="button" onClick={() => send()} aria-label="메시지 전송" disabled={!canSendChat || !draft.trim()}><Send size={17} /></button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
