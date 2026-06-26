import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BarChart3,
  Check,
  Download,
  Edit3,
  Eye,
  EyeOff,
  GripVertical,
  ListChecks,
  LogOut,
  Menu,
  Package,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  Utensils,
} from 'lucide-react';
import './styles.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.05,
  });
}

const todayKst = () => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
};

const currentMonthKst = () => todayKst().slice(0, 7);
const numberOrEmpty = (value) => (value === null || value === undefined ? '' : value);
const toNumberOrNull = (value) => (value === '' || value === null || value === undefined ? null : Number(value));
const units = ['Kg', 'g', '단', '봉', '개', '망', '박스', '구'];
const productUnits = ['박스', '봉', '묶음', '줄', '짝', '개', '통'];
const verdictDisplayOrder = ['부족', '정상', '과다'];
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = json.error || { code: 'INTERNAL_ERROR', message: '요청 처리 중 오류가 발생했습니다.' };
    if (error.code === 'UNAUTHORIZED') window.dispatchEvent(new Event('shinkal:unauthorized'));
    throw error;
  }
  return json;
}

function App() {
  const [authed, setAuthed] = useState(localStorage.getItem('shinkal-auth') === '1');
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const [branches, setBranches] = useState([]);
  const [operationPages, setOperationPages] = useState([]);
  const [branchId, setBranchId] = useState(null);
  const [businessDate, setBusinessDate] = useState(todayKst());
  const [statsMonth, setStatsMonth] = useState(currentMonthKst());
  const [view, setView] = useState({ type: 'operation', checklistId: 1 });
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [modalSaving, setModalSaving] = useState(false);
  const saveRef = useRef(null);
  const toastTimerRef = useRef(null);

  const registerSave = useCallback((handler) => {
    saveRef.current = handler;
    return () => {
      if (saveRef.current === handler) saveRef.current = null;
    };
  }, []);

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ message, tone });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => {
    if (!authed) return;
    const handleUnauthorized = () => logout();
    window.addEventListener('shinkal:unauthorized', handleUnauthorized);
    Promise.all([api('/api/branches'), api('/api/operations/templates')])
      .then(([branchData, templateData]) => {
        const pages = templateData.templates || [];
        setBranches(branchData.branches);
        setOperationPages(pages);
        setBranchId((current) => current || branchData.branches[0]?.branchId || null);
        setView((current) => {
          if (current.type !== 'operation' || pages.some((page) => page.id === current.checklistId)) return current;
          return { type: 'operation', checklistId: pages[0]?.id || 1 };
        });
      })
      .catch((error) => {
        if (error.code === 'UNAUTHORIZED') logout();
        else showToast(error.message, 'error');
      });
    return () => window.removeEventListener('shinkal:unauthorized', handleUnauthorized);
  }, [authed, showToast]);

  function guard(next) {
    if (!dirty) {
      next();
      return;
    }
    setPendingNavigation(() => next);
  }

  async function continueWithSave() {
    if (!pendingNavigation) return;
    if (!saveRef.current) {
      showToast('현재 화면을 저장할 수 없습니다.', 'error');
      return;
    }
    setModalSaving(true);
    const saved = await saveRef.current();
    setModalSaving(false);
    if (saved === false) return;
    const next = pendingNavigation;
    setPendingNavigation(null);
    setDirty(false);
    await Promise.resolve(next());
  }

  async function continueWithoutSave() {
    if (!pendingNavigation) return;
    const next = pendingNavigation;
    setPendingNavigation(null);
    setDirty(false);
    await Promise.resolve(next());
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
    localStorage.removeItem('shinkal-auth');
    setAuthed(false);
    setDirty(false);
  }

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  const currentTitle =
    view.type === 'operation'
      ? operationPages.find((page) => page.id === view.checklistId)?.title || '운영 체크리스트'
      : view.type === 'ingredients'
        ? '식자재 체크리스트'
      : view.type === 'products'
        ? '공산품 체크리스트'
        : view.type === 'stats'
          ? '통계'
          : '설정';
  const CurrentTitleIcon =
    view.type === 'operation'
      ? ListChecks
      : view.type === 'ingredients'
        ? Utensils
      : view.type === 'products'
        ? Package
        : view.type === 'stats'
          ? BarChart3
          : Settings;

  return (
    <div className={sidebarOpen ? 'app-shell' : 'app-shell sidebar-collapsed'}>
      {sidebarOpen && (
        <Sidebar
          view={view}
          operationPages={operationPages}
          onSelect={(nextView) => guard(() => setView(nextView))}
          onLogout={() => guard(logout)}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <main className="app-main">
        <Topbar
          title={currentTitle}
          Icon={CurrentTitleIcon}
          onOpenSidebar={() => setSidebarOpen(true)}
          branches={branches}
          branchId={branchId}
          periodType={view.type === 'stats' ? 'month' : 'date'}
          periodValue={view.type === 'stats' ? statsMonth : businessDate}
          onBranchChange={(value) => guard(() => setBranchId(Number(value)))}
          onPeriodChange={(value) => guard(() => (view.type === 'stats' ? setStatsMonth(value) : setBusinessDate(value)))}
        />
        {branchId && (
          <ScreenRouter
            view={view}
            operationPages={operationPages}
            branchId={branchId}
            businessDate={businessDate}
            statsMonth={statsMonth}
            setDirty={setDirty}
            dirty={dirty}
            showToast={showToast}
            registerSave={registerSave}
          />
        )}
      </main>
      {pendingNavigation && (
        <LeaveGuardModal
          saving={modalSaving}
          onSave={continueWithSave}
          onDiscard={continueWithoutSave}
          onCancel={() => setPendingNavigation(null)}
        />
      )}
      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}

function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      localStorage.setItem('shinkal-auth', '1');
      onSuccess();
    } catch (err) {
      setError(err.message || '비밀번호가 올바르지 않습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-logo wordmark">Shinkal</div>
      <h1>체크리스트</h1>
      <form className="login-card" onSubmit={submit}>
        <label>
          공용 비밀번호
          <div className="password-field">
            <input type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            <button type="button" className="icon-only" onClick={() => setShow((value) => !value)} aria-label="비밀번호 표시 전환">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {error && <p className="inline-error">{error}</p>}
        <button className="primary-button" disabled={loading}>
          {loading ? '확인 중' : '진입'}
        </button>
      </form>
    </main>
  );
}

function Sidebar({ view, operationPages, onSelect, onLogout, onClose }) {
  function select(nextView) {
    onSelect(nextView);
    if (typeof window !== 'undefined' && window.innerWidth <= 900) onClose();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo wordmark">Shinkal</div>
        <button type="button" className="nav-toggle sidebar-toggle" onClick={onClose} aria-label="사이드 메뉴 닫기">
          <Menu size={22} />
        </button>
      </div>
      <nav className="side-nav">
        <div className="side-parent"><ListChecks size={17} /> 운영 체크리스트</div>
        {operationPages.map((page) => (
          <button
            key={page.id}
            className={view.type === 'operation' && view.checklistId === page.id ? 'side-item nested active' : 'side-item nested'}
            onClick={() => select({ type: 'operation', checklistId: page.id })}
          >
            {page.title}
          </button>
        ))}
        <button className={view.type === 'ingredients' ? 'side-item active' : 'side-item'} onClick={() => select({ type: 'ingredients' })}>
          <Utensils size={17} /> 식자재
        </button>
        <button className={view.type === 'products' ? 'side-item active' : 'side-item'} onClick={() => select({ type: 'products' })}>
          <Package size={17} /> 공산품
        </button>
        <button className={view.type === 'stats' ? 'side-item active' : 'side-item'} onClick={() => select({ type: 'stats' })}>
          <BarChart3 size={17} /> 통계
        </button>
        <button className={view.type === 'settings' ? 'side-item active' : 'side-item'} onClick={() => select({ type: 'settings' })}>
          <Settings size={17} /> 설정
        </button>
      </nav>
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={17} /> 로그아웃
      </button>
    </aside>
  );
}

function openNativeDatePicker(event) {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    // Some browsers require direct pointer activation for showPicker().
  }
}

function Topbar({ title, Icon, onOpenSidebar, branches, branchId, periodType, periodValue, onBranchChange, onPeriodChange }) {
  return (
    <header className="context-bar">
      <button type="button" className="nav-toggle topbar-toggle" onClick={onOpenSidebar} aria-label="사이드 메뉴 열기">
        <Menu size={22} />
      </button>
      <h1 className="context-title">
        {Icon && <Icon size={22} aria-hidden="true" />}
        <span>{title}</span>
      </h1>
      <label>
        지점
        <select value={branchId || ''} onChange={(event) => onBranchChange(event.target.value)}>
          {branches.map((branch) => (
            <option key={branch.branchId} value={branch.branchId}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {periodType === 'month' ? '기준 월' : '영업일'}
        <input
          type={periodType === 'month' ? 'month' : 'date'}
          value={periodValue}
          onClick={openNativeDatePicker}
          onFocus={openNativeDatePicker}
          onChange={(event) => onPeriodChange(event.target.value)}
        />
      </label>
    </header>
  );
}

function ScreenRouter(props) {
  if (props.view.type === 'ingredients') return <IngredientChecklist {...props} />;
  if (props.view.type === 'products') return <ProductChecklist {...props} />;
  if (props.view.type === 'stats') return <StatsScreen {...props} month={props.statsMonth} />;
  if (props.view.type === 'settings') return <SettingsScreen {...props} />;
  return <OperationChecklist {...props} checklistId={props.view.checklistId} />;
}

function ScreenHeader({ badge, actions, meta, children }) {
  return (
    <section className="screen-header">
      <div className="screen-header-main">
        <div className="badge-line">
          <span className="badge">{badge}</span>
          {meta}
        </div>
        {children}
      </div>
      <div className="header-actions">{actions}</div>
    </section>
  );
}

function managerSlotsFrom(dataManagers, roles) {
  const roleSlots = (roles || []).slice(0, 2);
  const source = Array.isArray(dataManagers) ? dataManagers : [];
  return [
    { position: null, name: source[0]?.name || '' },
    ...roleSlots.map((role, index) => ({ position: role, name: source[index + 1]?.name || '' })),
  ];
}

function OperationChecklist({ checklistId, operationPages, branchId, businessDate, setDirty, dirty, showToast, registerSave }) {
  const page = operationPages.find((item) => item.id === checklistId) || operationPages[0] || null;
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [managers, setManagers] = useState([]);
  const [checked, setChecked] = useState({});
  const exportRef = useRef(null);
  const managerFields = useMemo(() => (page ? managerSlotsFrom(managers, page.roles) : []), [managers, page]);

  const flatItems = useMemo(
    () =>
      page
        ? page.sections.flatMap((section, sectionIndex) =>
            section.items.map((label, itemIndex) => ({
              itemKey: `c${page.id}-s${sectionIndex}-i${itemIndex}`,
              sectionName: section.title,
              itemLabel: label,
              sortOrder: sectionIndex * 100 + itemIndex,
            })),
          )
        : [],
    [page],
  );

  const totalScore = flatItems.filter((item) => checked[item.itemKey]).length;

  useEffect(() => {
    if (!page) return;
    setLoading(true);
    setDirty(false);
    api(`/api/operations?branchId=${branchId}&businessDate=${businessDate}&checklistId=${checklistId}`)
      .then((data) => {
        setVersion(data.version);
        setManagers(managerSlotsFrom(data.managers?.length ? data.managers : [{ position: data.managerPosition, name: data.managerName }], page.roles));
        setChecked(Object.fromEntries((data.checks || []).map((item) => [item.itemKey, item.checked])));
      })
      .catch((error) => showToast(error.message, 'error'))
      .finally(() => setLoading(false));
  }, [branchId, businessDate, checklistId, page, setDirty, showToast]);

  function updateManager(index, name) {
    setManagers((current) => managerSlotsFrom(current, page.roles).map((manager, managerIndex) => (managerIndex === index ? { ...manager, name } : manager)));
    setDirty(true);
  }

  function toggle(itemKey) {
    setChecked((current) => ({ ...current, [itemKey]: !current[itemKey] }));
    setDirty(true);
  }

  function reset() {
    if (!page) return;
    if (!window.confirm('현재 화면 입력을 비울까요? 저장된 기록은 삭제되지 않습니다.')) return;
    setChecked({});
    setManagers(managerSlotsFrom([], page.roles));
    setDirty(true);
  }

  async function save() {
    if (!page) return false;
    try {
      const payload = {
        branchId,
        businessDate,
        checklistId,
        managerName: managerFields[0]?.name || '',
        managerPosition: managerFields[1]?.position || null,
        managers: managerFields,
        version,
        checks: flatItems.map((item) => ({ ...item, checked: Boolean(checked[item.itemKey]) })),
      };
      const data = await api('/api/operations', { method: 'PUT', body: JSON.stringify(payload) });
      setVersion(data.version);
      setDirty(false);
      showToast('운영 체크리스트를 저장했습니다.');
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    }
  }

  useEffect(() => registerSave(save), [registerSave, save]);

  if (!page) return <LoadingCard />;

  return (
    <div className="screen-grid" ref={exportRef}>
      <div>
        <ScreenHeader
          badge={page.phase}
          actions={<ScreenActions dirty={dirty} onSave={save} onReset={reset} onPdf={() => exportPdf(exportRef, page.title)} />}
        >
          <div className="header-fields manager-fields">
            {managerFields.map((manager, index) => (
              <label key={manager.position || 'primary'}>
                {index === 0 ? '담당자명' : `담당 포지션(${manager.position})`}
                <input value={manager.name} onChange={(event) => updateManager(index, event.target.value)} />
              </label>
            ))}
          </div>
        </ScreenHeader>
        {loading ? (
          <LoadingCard />
        ) : (
          page.sections.map((section, sectionIndex) => (
            <section className="check-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.items.map((label, itemIndex) => {
                const itemKey = `c${page.id}-s${sectionIndex}-i${itemIndex}`;
                return (
                  <button key={itemKey} className={checked[itemKey] ? 'check-row checked' : 'check-row'} onClick={() => toggle(itemKey)}>
                    <span className="checkbox">{checked[itemKey] && <Check size={16} />}</span>
                    <span className="check-number">{itemIndex + 1}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </section>
          ))
        )}
        <BottomSaveAction dirty={dirty} onSave={save} />
      </div>
      <aside className="inspector">
        <div className="score-ring" style={{ '--score': `${flatItems.length ? (totalScore / flatItems.length) * 100 : 0}%` }}>
          <strong>{totalScore}</strong>
          <span>{flatItems.length}개 중</span>
        </div>
        <h2>미체크 항목</h2>
        <ul>
          {flatItems
            .filter((item) => !checked[item.itemKey])
            .slice(0, 8)
            .map((item) => (
              <li key={item.itemKey}>{item.itemLabel}</li>
            ))}
        </ul>
      </aside>
    </div>
  );
}

function IngredientChecklist({ branchId, businessDate, setDirty, dirty, showToast, registerSave }) {
  const [state, setState] = useState(null);
  const exportRef = useRef(null);
  const unitOptions = useSettingsUnitOptions();

  useEffect(() => {
    setDirty(false);
    api(`/api/ingredients?branchId=${branchId}&businessDate=${businessDate}`)
      .then(setState)
      .catch((error) => showToast(error.message, 'error'));
  }, [branchId, businessDate]);

  function updateLine(index, patch) {
    setState((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)) }));
    setDirty(true);
  }

  async function save() {
    if (!state) return false;
    try {
      const data = await api('/api/ingredients', {
        method: 'PUT',
        body: JSON.stringify({
          branchId,
          businessDate,
          managerName: state.managerName,
          version: state.version,
          catalogVersion: state.catalogVersion,
          lines: state.lines.map(({ itemId, unit, unitOption, baseUsage, actualUsage, verdict, cause, stock, unitPrice }) => ({
            itemId,
            unit,
            unitOption,
            baseUsage: toNumberOrNull(baseUsage),
            actualUsage: toNumberOrNull(actualUsage),
            verdict,
            cause,
            stock: toNumberOrNull(stock),
            unitPrice: toNumberOrNull(unitPrice),
          })),
        }),
      });
      setState((current) => ({ ...current, version: data.version, catalogVersion: data.catalogVersion }));
      setDirty(false);
      showToast('식자재 체크리스트를 저장했습니다.');
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    }
  }

  useEffect(() => registerSave(save), [registerSave, save]);

  if (!state) return <LoadingCard />;

  const risingCount = state.lines.filter((line) => priceDirection(line.prevUnitPrice, line.unitPrice) === 'up').length;
  const risingTone = risingCount === 0 ? '' : risingCount === 1 ? 'good' : risingCount <= 3 ? 'warn' : 'bad';

  function reset() {
    if (!window.confirm('현재 화면 입력을 비울까요? 저장된 기록은 삭제되지 않습니다.')) return;
    setState((current) => ({
      ...current,
      managerName: '',
      lines: current.lines.map((line) => ({ ...line, actualUsage: null, cause: '', stock: null, unitPrice: null, verdict: '정상' })),
    }));
    setDirty(true);
  }

  return (
    <section ref={exportRef}>
      <ScreenHeader
        badge="식자재"
        meta={<span className={`rising-count ${risingTone}`}>전회차 대비 상승 {risingCount}개</span>}
        actions={<ScreenActions dirty={dirty} onSave={save} onReset={reset} onPdf={() => exportPdf(exportRef, '식자재 체크리스트')} />}
      >
        <div className="header-fields">
          <label>
            담당자명
            <input value={state.managerName || ''} onChange={(event) => (setState({ ...state, managerName: event.target.value }), setDirty(true))} />
          </label>
        </div>
      </ScreenHeader>
      <div className="table-wrap">
        <table className="data-table ingredient-table">
          <thead>
            <tr>
              <th>품목</th>
              <th>단위</th>
              <th>기준 사용량</th>
              <th>실제 사용량</th>
              <th>차이</th>
              <th>재고</th>
              <th>공급단가</th>
              <th>전회차 단가</th>
              <th>단가</th>
              <th>판정</th>
              <th>원인</th>
            </tr>
          </thead>
          <tbody>
            {state.lines.map((line, index) => {
              const diff = line.actualUsage === null || line.actualUsage === '' || line.baseUsage === null || line.baseUsage === '' ? '-' : Number(line.actualUsage) - Number(line.baseUsage);
              const priceState = priceDirection(line.prevUnitPrice, line.unitPrice);
              const showCategoryHeader = index === 0 || state.lines[index - 1]?.categoryName !== line.categoryName;
              return (
                <React.Fragment key={line.itemId}>
                  {showCategoryHeader && (
                    <tr className="category-row">
                      <td colSpan={11}>{line.categoryName}</td>
                    </tr>
                  )}
                  <tr>
                    <td>
                      <strong>{line.itemName}</strong>
                    </td>
                    <td>
                      <div className="unit-pair">
                        <select value={line.unit || ''} onChange={(event) => updateLine(index, { unit: event.target.value, unitOption: '' })}>
                          {units.map((unit) => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </select>
                        {unitOptions[line.unit]?.length ? (
                          <select value={line.unitOption || ''} onChange={(event) => updateLine(index, { unitOption: event.target.value })}>
                            <option value="">선택</option>
                            {unitOptions[line.unit].map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    </td>
                    <td className="numeric-cell"><NumberInput value={line.baseUsage} onChange={(value) => updateLine(index, { baseUsage: value })} /></td>
                    <td className="numeric-cell"><NumberInput value={line.actualUsage} onChange={(value) => updateLine(index, { actualUsage: value })} /></td>
                    <td className="numeric-cell">{diff}</td>
                    <td className="numeric-cell"><NumberInput value={line.stock} onChange={(value) => updateLine(index, { stock: value })} /></td>
                    <td className="numeric-cell"><NumberInput value={line.unitPrice} onChange={(value) => updateLine(index, { unitPrice: value })} /></td>
                    <td className="numeric-cell">{numberOrEmpty(line.prevUnitPrice)}</td>
                    <td className="numeric-cell"><PriceBadge state={priceState} /></td>
                    <td>
                      <div className="segmented">
                        {verdictDisplayOrder.map((verdict) => (
                          <button key={verdict} className={line.verdict === verdict ? 'active' : ''} onClick={() => updateLine(index, { verdict })}>
                            {verdict}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td><input value={line.cause || ''} onChange={(event) => updateLine(index, { cause: event.target.value })} /></td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <BottomSaveAction dirty={dirty} onSave={save} />
    </section>
  );
}

function ProductChecklist({ branchId, businessDate, setDirty, dirty, showToast, registerSave }) {
  const [state, setState] = useState(null);
  const exportRef = useRef(null);

  useEffect(() => {
    setDirty(false);
    api(`/api/products?branchId=${branchId}&businessDate=${businessDate}`)
      .then(setState)
      .catch((error) => showToast(error.message, 'error'));
  }, [branchId, businessDate]);

  function updateLine(index, patch) {
    setState((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)) }));
    setDirty(true);
  }

  async function save() {
    if (!state) return false;
    try {
      const data = await api('/api/products', {
        method: 'PUT',
        body: JSON.stringify({
          branchId,
          businessDate,
          managerName: state.managerName,
          version: state.version,
          catalogVersion: state.catalogVersion,
          lines: state.lines.map(({ itemId, unit, stock, restockQty }) => ({ itemId, unit, stock: toNumberOrNull(stock), restockQty: toNumberOrNull(restockQty) })),
        }),
      });
      setState((current) => ({ ...current, version: data.version, catalogVersion: data.catalogVersion }));
      setDirty(false);
      showToast('공산품 체크리스트를 저장했습니다.');
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    }
  }

  useEffect(() => registerSave(save), [registerSave, save]);

  if (!state) return <LoadingCard />;

  function reset() {
    if (!window.confirm('현재 화면 입력을 비울까요? 저장된 기록은 삭제되지 않습니다.')) return;
    setState((current) => ({ ...current, lines: current.lines.map((line) => ({ ...line, stock: null, restockQty: null })) }));
    setDirty(true);
  }

  return (
    <section ref={exportRef}>
      <ScreenHeader
        badge="공산품"
        actions={<ScreenActions dirty={dirty} onSave={save} onReset={reset} onPdf={() => exportPdf(exportRef, '공산품 체크리스트')} />}
      >
        <div className="header-fields">
          <label>
            담당자명
            <input value={state.managerName || ''} onChange={(event) => (setState({ ...state, managerName: event.target.value }), setDirty(true))} />
          </label>
        </div>
      </ScreenHeader>
      <div className="table-wrap narrow">
        <table className="data-table product-table">
          <thead>
            <tr><th>품목</th><th>단위</th><th>입고</th><th>재고</th><th>여유재고</th></tr>
          </thead>
          <tbody>
            {state.lines.map((line, index) => (
              <tr key={line.itemId}>
                <td>{line.itemName}</td>
                <td>
                  <select value={line.unit || '개'} onChange={(event) => updateLine(index, { unit: event.target.value })}>
                    {productUnits.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </td>
                <td className="numeric-cell"><NumberInput value={line.restockQty} onChange={(value) => updateLine(index, { restockQty: value })} /></td>
                <td className="numeric-cell"><NumberInput value={line.stock} onChange={(value) => updateLine(index, { stock: value })} /></td>
                <td className="numeric-cell readonly-cell">{numberOrEmpty(line.spareStock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BottomSaveAction dirty={dirty} onSave={save} />
    </section>
  );
}

function StatsScreen({ branchId, month, showToast }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [selectedIngredientId, setSelectedIngredientId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');

  useEffect(() => {
    if (!branchId || !month) return;
    setLoading(true);
    Promise.all([
      api(`/api/stats/ingredients?branchId=${branchId}&month=${month}`),
      api(`/api/stats/products?branchId=${branchId}&month=${month}`),
      api(`/api/stats/operations?branchId=${branchId}&month=${month}`),
    ])
      .then(([ingredients, products, operations]) => {
        setStats({ ingredients, products, operations });
        setSelectedIngredientId((current) => current || String(ingredients.priceItems?.[0]?.itemId || ''));
        setSelectedProductId((current) => current || String(products.productItems?.[0]?.itemId || ''));
      })
      .catch((error) => showToast(error.message, 'error'))
      .finally(() => setLoading(false));
  }, [branchId, month, showToast]);

  useEffect(() => {
    if (!stats) return;
    if (!stats.ingredients.priceItems?.some((item) => String(item.itemId) === String(selectedIngredientId))) {
      setSelectedIngredientId(String(stats.ingredients.priceItems?.[0]?.itemId || ''));
    }
    if (!stats.products.productItems?.some((item) => String(item.itemId) === String(selectedProductId))) {
      setSelectedProductId(String(stats.products.productItems?.[0]?.itemId || ''));
    }
  }, [stats, selectedIngredientId, selectedProductId]);

  if (loading) return <LoadingCard />;
  if (!stats) return <EmptyState title="통계를 불러오지 못했습니다." />;

  const ingredientTrend = stats.ingredients.priceTrend?.find((item) => String(item.itemId) === String(selectedIngredientId));
  const priceLineData = (ingredientTrend?.points || []).slice(-6).map((point) => ({
    month: point.month,
    avgPrice: point.avgPrice,
    minPrice: point.minPrice,
    maxPrice: point.maxPrice,
  }));
  const productMonthly = stats.products.monthlyAverages?.find((item) => String(item.itemId) === String(selectedProductId));
  const productLineData = (productMonthly?.points || []).map((point) => ({
    month: point.month,
    avgDailyUsage: point.avgDailyUsage,
    totalUsage: point.totalUsage,
    days: point.days,
  }));
  const excessData = (stats.ingredients.excessTop10 || []).slice(0, 5).map((item) => ({
    name: item.itemName,
    excessUsage: item.excessUsage,
  }));
  const increaseData = (stats.ingredients.priceIncreaseTop5 || []).map((item) => ({
    name: item.itemName,
    increase: item.increase,
    previousAvg: item.previousAvg,
    currentAvg: item.currentAvg,
  }));
  const missingData = (stats.operations.missingTop5 || []).map((item) => ({
    itemLabel: item.itemLabel,
    checklistName: item.checklistName,
    missingCount: item.missingCount,
  }));
  const completionData = (stats.operations.completionRates || []).map((item) => ({
    name: compactChecklistName(item.checklistName),
    fullName: item.checklistName,
    avgCompletionRate: item.avgCompletionRate,
    recordCount: item.recordCount,
    hasRecord: item.hasRecord,
  }));

  return (
    <section className="stats-screen">
      <div className="stats-kpi-grid">
        <StatsKpi title="단가 상승 품목" value={`${stats.ingredients.priceIncreaseTop5?.length || 0}개`} meta={`${month} 전월 대비`} />
        <StatsKpi title="기준 초과 품목 수" value={`${stats.ingredients.excessItemCount || 0}개`} meta="기준 대비 초과" />
        <StatsKpi title="운영 평균 완료율" value={`${formatMetric(stats.operations.overallCompletionRate)}%`} meta="전체 운영 기록 평균" />
      </div>

      <div className="stats-grid">
        <StatsCard
          title="식자재 월별 평균 단가 추이"
          action={(
            <select className="stats-select" value={selectedIngredientId} onChange={(event) => setSelectedIngredientId(event.target.value)}>
              {(stats.ingredients.priceItems || []).map((item) => <option key={item.itemId} value={item.itemId}>{item.itemName}</option>)}
            </select>
          )}
        >
          {priceLineData.some((point) => point.avgPrice !== null) ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={priceLineData} margin={{ top: 12, right: 30, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} interval={0} />
                <YAxis tick={{ fontSize: 12 }} width={48} />
                <Tooltip content={<StatsTooltip kind="price" />} cursor={{ stroke: 'rgba(0,0,0,0.16)', strokeWidth: 1 }} isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none' }} />
                <Line type="monotone" dataKey="avgPrice" name="평균" stroke="#EF4444" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="단가 기록이 없습니다." />
          )}
        </StatsCard>

        <StatsCard title="이번 달 단가 상승 Top5">
          {increaseData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={increaseData} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={86} />
                <Tooltip content={<StatsTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none' }} />
                <Bar dataKey="increase" name="상승폭" radius={[0, 6, 6, 0]} fill="#EF4444" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="상승 품목이 없습니다." />
          )}
        </StatsCard>

        <StatsCard
          title="공산품 월별 평균 사용량 추이"
          action={(
            <select className="stats-select" value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
              {(stats.products.productItems || []).map((item) => <option key={item.itemId} value={item.itemId}>{item.itemName}</option>)}
            </select>
          )}
        >
          {productLineData.some((point) => point.days > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={productLineData} margin={{ top: 12, right: 30, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} interval={0} />
                <YAxis tick={{ fontSize: 12 }} width={42} />
                <Tooltip content={<StatsTooltip kind="product" />} cursor={{ stroke: 'rgba(0,0,0,0.16)', strokeWidth: 1 }} isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none' }} />
                <Line type="monotone" dataKey="avgDailyUsage" name="월 평균 사용량" stroke="#F59E0B" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="계산 가능한 재고 기록이 없습니다." />
          )}
        </StatsCard>

        <StatsCard title="이번 달 식자재 초과 사용량 Top5">
          {excessData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={excessData} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={96} />
                <Tooltip content={<StatsTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none' }} />
                <Bar dataKey="excessUsage" name="초과량" fill="#F97316" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="기준 초과 품목이 없습니다." />
          )}
        </StatsCard>

        <StatsCard title="이번 달 운영 체크리스트별 평균 완료율">
          {completionData.length ? (
            <ResponsiveContainer width="100%" height={330}>
              <BarChart data={completionData} margin={{ top: 8, right: 16, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={76} />
                <YAxis tick={{ fontSize: 12 }} width={44} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                <Tooltip content={<StatsTooltip kind="percent" />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} isAnimationActive={false} wrapperStyle={{ pointerEvents: 'none' }} />
                <Bar dataKey="avgCompletionRate" name="평균 완료율" fill="#F97316" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="운영 기록이 없습니다." />
          )}
        </StatsCard>

        <StatsCard title="이번 달 운영 누락 항목 Top5">
          {missingData.length ? (
            <StatsRankTable rows={missingData} />
          ) : (
            <EmptyState title="누락 기록이 없습니다." />
          )}
        </StatsCard>
      </div>
    </section>
  );
}

function StatsKpi({ title, value, meta }) {
  return (
    <article className="stats-kpi">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function StatsCard({ title, action, className = '', children }) {
  return (
    <article className={`stats-card ${className}`}>
      <div className="stats-card-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </article>
  );
}

function StatsRankTable({ rows }) {
  return (
    <div className="stats-rank-table">
      <div className="stats-rank-head">
        <span aria-hidden="true" />
        <span>항목</span>
        <span>소속</span>
        <span>누락횟수</span>
      </div>
      {rows.map((row, index) => (
        <div className="stats-rank-row" key={`${row.itemLabel}-${row.checklistName}`}>
          <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>
          <div className="rank-item">
            <strong>{row.itemLabel}</strong>
          </div>
          <span className="rank-source">{row.checklistName}</span>
          <strong className="rank-count">{formatMetric(row.missingCount)}</strong>
        </div>
      ))}
    </div>
  );
}

function StatsTooltip({ active, payload, label, kind = 'default' }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const suffix = kind === 'percent' ? '%' : '';
  const title = kind === 'percent' ? row.fullName || label : row.month || label;
  return (
    <div className="chart-tooltip">
      <strong>{title}</strong>
      {payload.map((entry) => (
        <span key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: {formatMetric(entry.value)}{suffix}
        </span>
      ))}
      {kind === 'price' && row.minPrice !== undefined && row.minPrice !== null && <span>최저: {formatMetric(row.minPrice)}</span>}
      {kind === 'price' && row.maxPrice !== undefined && row.maxPrice !== null && <span>최고: {formatMetric(row.maxPrice)}</span>}
      {kind === 'product' && row.days !== undefined && <span>계산 일수: {row.days}</span>}
    </div>
  );
}

function EmptyState({ title }) {
  return <div className="empty-state">{title}</div>;
}

function roundDisplay(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.round(Number(value) * 10) / 10;
}

function formatMetric(value) {
  if (value === null || value === undefined || value === '') return '-';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(numberValue);
}

function compactChecklistName(name) {
  return String(name || '')
    .replace(/^매장\s*/, '')
    .replace('주방 서서브', '주서서')
    .replace('주방 서브', '주서')
    .replace('주방 메인', '주메')
    .replace('홀 - 서서브', '홀-서서')
    .replace('홀 - 서브', '홀-서')
    .replace('홀 - 메인', '홀-메');
}

function SettingsScreen({ showToast }) {
  const [tab, setTab] = useState('ingredients');
  return (
    <section className="settings-screen">
      <div className="tabs">
        <button className={tab === 'ingredients' ? 'active' : ''} onClick={() => setTab('ingredients')}>식자재</button>
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>공산품</button>
      </div>
      {tab === 'ingredients' ? <IngredientSettings showToast={showToast} /> : <ProductSettings showToast={showToast} />}
    </section>
  );
}

function reorderIds(rows, idKey, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return null;
  const orderedIds = rows.map((row) => Number(row[idKey]));
  const from = orderedIds.indexOf(Number(sourceId));
  const to = orderedIds.indexOf(Number(targetId));
  if (from < 0 || to < 0) return null;
  const [moved] = orderedIds.splice(from, 1);
  orderedIds.splice(to, 0, moved);
  return orderedIds;
}

const rowKey = (scope, id) => `${scope}-${id}`;

function IngredientSettings({ showToast }) {
  const [state, setState] = useState(null);
  const [categoryName, setCategoryName] = useState('');
  const [itemForm, setItemForm] = useState({ categoryId: '', name: '', defaultUnit: 'Kg', defaultUnitOption: '', defaultBaseUsage: '' });
  const [optionForm, setOptionForm] = useState({ unit: 'Kg', value: '' });
  const [highlightKey, setHighlightKey] = useState(null);
  const [invalidKey, setInvalidKey] = useState(null);
  const categoryInputRef = useRef(null);
  const itemNameInputRef = useRef(null);
  const optionValueInputRef = useRef(null);

  const load = () => api('/api/settings/ingredients').then(setState).catch((error) => showToast(error.message, 'error'));
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightKey) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-row-key="${highlightKey}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => setHighlightKey(null), 1800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightKey, state]);

  if (!state) return <LoadingCard />;

  function markInvalid(key, ref, message) {
    setInvalidKey(null);
    window.requestAnimationFrame(() => setInvalidKey(key));
    window.setTimeout(() => setInvalidKey((current) => (current === key ? null : current)), 900);
    ref.current?.focus();
    showToast(message, 'error');
  }

  async function mutate(path, body, method = 'POST') {
    try {
      const data = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
      await load();
      showToast('설정을 반영했습니다.');
      return data;
    } catch (error) {
      showToast(error.message, 'error');
      return null;
    }
  }

  async function addCategory() {
    if (!categoryName.trim()) {
      markInvalid('categoryName', categoryInputRef, '카테고리명을 입력하세요.');
      return;
    }
    const created = await mutate('/api/settings/ingredient-categories', { name: categoryName });
    if (!created?.categoryId) return;
    setCategoryName('');
    setHighlightKey(rowKey('ingredient-category', created.categoryId));
  }

  async function addIngredientItem() {
    const categoryId = Number(itemForm.categoryId || state.categories[0]?.categoryId);
    if (!categoryId || !itemForm.name.trim()) {
      markInvalid('itemName', itemNameInputRef, '품목명을 입력하세요.');
      return;
    }
    const payload = { ...itemForm, categoryId };
    const created = await mutate('/api/settings/ingredient-items', payload);
    if (!created?.itemId) return;
    setItemForm({ ...itemForm, categoryId, name: '', defaultBaseUsage: '' });
    setHighlightKey(rowKey('ingredient-item', created.itemId));
  }

  async function addUnitOption() {
    if (!String(optionForm.value).trim()) {
      markInvalid('unitOptionValue', optionValueInputRef, '옵션 값을 입력하세요.');
      return;
    }
    const created = await mutate('/api/settings/ingredient-unit-options', optionForm);
    if (!created?.optionId) return;
    setOptionForm({ ...optionForm, value: '' });
    setHighlightKey(rowKey('ingredient-unit-option', created.optionId));
  }

  function reorder(path, rows, idKey, sourceId, targetId) {
    const orderedIds = reorderIds(rows, idKey, sourceId, targetId);
    if (!orderedIds) return;
    mutate(path, { orderedIds }, 'PATCH');
  }

  return (
    <div className="settings-grid">
      <SettingsCard title="카테고리">
        <div className="inline-add category-form">
          <input ref={categoryInputRef} className={invalidKey === 'categoryName' ? 'field-invalid' : ''} placeholder="카테고리명" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
          <button className="secondary-button inline-add-button" onClick={addCategory}><Plus size={16} /> 추가</button>
        </div>
        <SettingsColumnHeader layoutClass="settings-row-category" labels={['카테고리명']} />
        {state.categories.map((category) => (
          <EditableRow
            key={category.categoryId}
            layoutClass="settings-row-category"
            dataRowKey={rowKey('ingredient-category', category.categoryId)}
            highlighted={highlightKey === rowKey('ingredient-category', category.categoryId)}
            item={category}
            fields={[{ key: 'name', label: '카테고리명' }]}
            onSave={(draft) => mutate(`/api/settings/ingredient-categories/${category.categoryId}`, { name: draft.name, version: category.version }, 'PATCH')}
            onDelete={() => window.confirm('삭제할까요?') && mutate(`/api/settings/ingredient-categories/${category.categoryId}`, { version: category.version }, 'DELETE')}
            draggable
            dragId={category.categoryId}
            onDropRow={(sourceId, targetId) => reorder('/api/settings/ingredient-categories/reorder', state.categories, 'categoryId', sourceId, targetId)}
          />
        ))}
      </SettingsCard>
      <SettingsCard title="식자재 품목">
        <div className="inline-add item-form">
          <select value={itemForm.categoryId || state.categories[0]?.categoryId || ''} onChange={(event) => setItemForm({ ...itemForm, categoryId: Number(event.target.value) })}>
            <option value="">카테고리</option>
            {state.categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
          </select>
          <input ref={itemNameInputRef} className={invalidKey === 'itemName' ? 'field-invalid' : ''} placeholder="품목명" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} />
          <select value={itemForm.defaultUnit} onChange={(event) => setItemForm({ ...itemForm, defaultUnit: event.target.value })}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select>
          <input placeholder="기준" value={itemForm.defaultBaseUsage} onChange={(event) => setItemForm({ ...itemForm, defaultBaseUsage: event.target.value })} />
          <button className="secondary-button inline-add-button" onClick={addIngredientItem}><Plus size={16} /> 추가</button>
        </div>
        {state.categories.map((category) => (
          <div key={category.categoryId} className="settings-group">
            <h3>{category.name}</h3>
            <SettingsColumnHeader layoutClass="settings-row-ingredient" labels={['품목명', '단위', '기준 사용량']} />
            {state.items
              .filter((item) => item.categoryId === category.categoryId)
              .map((item, _index, rows) => (
                <EditableRow
                  key={item.itemId}
                  layoutClass="settings-row-ingredient"
                  dataRowKey={rowKey('ingredient-item', item.itemId)}
                  highlighted={highlightKey === rowKey('ingredient-item', item.itemId)}
                  item={item}
                  fields={[{ key: 'name', label: '품목명' }, { key: 'defaultUnit', label: '단위', type: 'select', options: units }, { key: 'defaultBaseUsage', label: '기준' }]}
                  onSave={(draft) => mutate(`/api/settings/ingredient-items/${item.itemId}`, { ...draft, categoryId: item.categoryId, version: item.version }, 'PATCH')}
                  onDelete={() => window.confirm('삭제할까요?') && mutate(`/api/settings/ingredient-items/${item.itemId}`, { version: item.version }, 'DELETE')}
                  draggable
                  dragId={item.itemId}
                  onDropRow={(sourceId, targetId) => reorder('/api/settings/ingredient-items/reorder', rows, 'itemId', sourceId, targetId)}
                />
              ))}
          </div>
        ))}
      </SettingsCard>
      <SettingsCard title="단위 옵션">
        <div className="inline-add unit-option-form">
          <select value={optionForm.unit} onChange={(event) => setOptionForm({ ...optionForm, unit: event.target.value })}>{['Kg', 'g', '구'].map((unit) => <option key={unit}>{unit}</option>)}</select>
          <input ref={optionValueInputRef} className={invalidKey === 'unitOptionValue' ? 'field-invalid' : ''} placeholder="옵션 값" value={optionForm.value} onChange={(event) => setOptionForm({ ...optionForm, value: event.target.value })} />
          <button className="secondary-button inline-add-button" onClick={addUnitOption}><Plus size={16} /> 추가</button>
        </div>
        {['Kg', 'g', '구'].map((unit) => (
          <div key={unit} className="settings-group">
            <h3>{unit}</h3>
            <SettingsColumnHeader layoutClass="settings-row-unit-option" labels={['값']} />
            {state.unitOptions
              .filter((option) => option.unit === unit)
              .map((option, _index, rows) => (
                <EditableRow
                  key={option.optionId}
                  layoutClass="settings-row-unit-option"
                  dataRowKey={rowKey('ingredient-unit-option', option.optionId)}
                  highlighted={highlightKey === rowKey('ingredient-unit-option', option.optionId)}
                  item={option}
                  fields={[{ key: 'value', label: '값' }]}
                  onSave={(draft) => mutate(`/api/settings/ingredient-unit-options/${option.optionId}`, { value: draft.value, version: option.version }, 'PATCH')}
                  onDelete={() => window.confirm('삭제할까요?') && mutate(`/api/settings/ingredient-unit-options/${option.optionId}`, { version: option.version }, 'DELETE')}
                  draggable
                  dragId={option.optionId}
                  onDropRow={(sourceId, targetId) => reorder('/api/settings/ingredient-unit-options/reorder', rows, 'optionId', sourceId, targetId)}
                />
              ))}
          </div>
        ))}
      </SettingsCard>
    </div>
  );
}

function ProductSettings({ showToast }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ name: '', defaultUnit: '개', spareStock: '1' });
  const [highlightKey, setHighlightKey] = useState(null);
  const [invalidKey, setInvalidKey] = useState(null);
  const productNameInputRef = useRef(null);
  const load = () => api('/api/settings/products').then(setState).catch((error) => showToast(error.message, 'error'));
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightKey) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-row-key="${highlightKey}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => setHighlightKey(null), 1800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightKey, state]);

  if (!state) return <LoadingCard />;
  function markInvalid(key, ref, message) {
    setInvalidKey(null);
    window.requestAnimationFrame(() => setInvalidKey(key));
    window.setTimeout(() => setInvalidKey((current) => (current === key ? null : current)), 900);
    ref.current?.focus();
    showToast(message, 'error');
  }
  async function mutate(path, body, method = 'POST') {
    try {
      const data = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
      await load();
      showToast('설정을 반영했습니다.');
      return data;
    } catch (error) {
      showToast(error.message, 'error');
      return null;
    }
  }
  async function addProductItem() {
    if (!form.name.trim()) {
      markInvalid('productName', productNameInputRef, '품목명을 입력하세요.');
      return;
    }
    const created = await mutate('/api/settings/product-items', form);
    if (!created?.itemId) return;
    setForm({ ...form, name: '', spareStock: '1' });
    setHighlightKey(rowKey('product-item', created.itemId));
  }
  function reorder(rows, sourceId, targetId) {
    const orderedIds = reorderIds(rows, 'itemId', sourceId, targetId);
    if (!orderedIds) return;
    mutate('/api/settings/product-items/reorder', { orderedIds }, 'PATCH');
  }
  return (
    <SettingsCard title="공산품 품목">
      <div className="inline-add product-form">
        <input ref={productNameInputRef} className={invalidKey === 'productName' ? 'field-invalid' : ''} placeholder="품목명" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <select value={form.defaultUnit} onChange={(event) => setForm({ ...form, defaultUnit: event.target.value })}>{productUnits.map((unit) => <option key={unit}>{unit}</option>)}</select>
        <input placeholder="여유재고" inputMode="decimal" value={form.spareStock} onChange={(event) => setForm({ ...form, spareStock: event.target.value })} />
        <button className="secondary-button inline-add-button" onClick={addProductItem}><Plus size={16} /> 추가</button>
      </div>
      <SettingsColumnHeader layoutClass="settings-row-product" labels={['품목명', '단위', '여유재고']} />
      {state.items.map((item) => (
        <EditableRow
          key={item.itemId}
          layoutClass="settings-row-product"
          dataRowKey={rowKey('product-item', item.itemId)}
          highlighted={highlightKey === rowKey('product-item', item.itemId)}
          item={item}
          fields={[
            { key: 'name', label: '품목명' },
            { key: 'defaultUnit', label: '단위', type: 'select', options: productUnits },
            { key: 'spareStock', label: '여유재고', type: 'number' },
          ]}
          onSave={(draft) => mutate(`/api/settings/product-items/${item.itemId}`, { ...draft, version: item.version }, 'PATCH')}
          onDelete={() => window.confirm('삭제할까요?') && mutate(`/api/settings/product-items/${item.itemId}`, { version: item.version }, 'DELETE')}
          draggable
          dragId={item.itemId}
          onDropRow={(sourceId, targetId) => reorder(state.items, sourceId, targetId)}
        />
      ))}
    </SettingsCard>
  );
}

function SettingsCard({ title, children }) {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SettingsColumnHeader({ layoutClass, labels }) {
  return (
    <div className={`settings-column-header ${layoutClass}`}>
      <span aria-hidden="true" />
      {labels.map((label) => <span key={label}>{label}</span>)}
      <span className="settings-row-spacer" aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

function EditableRow({ item, fields, onSave, onDelete, draggable = false, dragId, onDropRow, dataRowKey, highlighted = false, layoutClass = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);

  function dragStart(event) {
    if (!draggable || editing) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragId));
    window.__shinkalDragSourceId = Number(dragId);
  }

  function dragOver(event) {
    if (!draggable || editing) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function drop(event) {
    if (!draggable || editing) return;
    event.preventDefault();
    const sourceId = Number(event.dataTransfer.getData('text/plain') || window.__shinkalDragSourceId);
    window.__shinkalDragSourceId = null;
    onDropRow?.(sourceId, Number(dragId));
  }

  function dragEnd() {
    window.__shinkalDragSourceId = null;
  }

  return (
    <div
      className={`${draggable ? 'editable-row draggable' : 'editable-row'} ${layoutClass}${highlighted ? ' highlighted' : ''}`}
      data-row-key={dataRowKey}
      draggable={draggable && !editing}
      onDragStart={dragStart}
      onDragOver={dragOver}
      onDrop={drop}
      onDragEnd={dragEnd}
    >
      {draggable && (
        <span className="drag-handle" title="드래그해서 순서 변경" aria-label="순서 변경 핸들">
          <GripVertical size={16} />
        </span>
      )}
      {fields.map((field) => (
        editing ? (
          field.type === 'select' ? (
            <select key={field.key} value={draft[field.key] ?? ''} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}>
              {(field.options || []).map((option) => <option key={option}>{option}</option>)}
            </select>
          ) : (
            <input key={field.key} inputMode={field.type === 'number' ? 'decimal' : undefined} value={draft[field.key] ?? ''} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
          )
        ) : (
          <span key={field.key}>{item[field.key]}</span>
        )
      ))}
      <span className="settings-row-spacer" aria-hidden="true" />
      <div className="row-actions">
        {editing ? (
          <button aria-label="저장" onClick={() => (onSave(draft), setEditing(false))}><Check size={16} /></button>
        ) : (
          <button aria-label="수정" onClick={() => setEditing(true)}><Edit3 size={16} /></button>
        )}
        <button aria-label="삭제" onClick={onDelete}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function LeaveGuardModal({ saving, onSave, onDiscard, onCancel }) {
  return (
    <div className="modal-backdrop">
      <section className="leave-modal" role="dialog" aria-modal="true" aria-labelledby="leave-modal-title">
        <h2 id="leave-modal-title">변경사항을 저장할까요?</h2>
        <p>저장하지 않은 입력이 있습니다. 저장 후 이동하거나, 변경사항을 버리고 이동할 수 있습니다.</p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} disabled={saving}>취소</button>
          <button className="secondary-button danger-text" onClick={onDiscard} disabled={saving}>저장 안 함</button>
          <button className="primary-button" onClick={onSave} disabled={saving}>
            {saving ? '저장 중' : '저장'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ScreenActions({ dirty, onSave, onReset, onPdf }) {
  return (
    <>
      <button className="secondary-button" onClick={onReset}><RotateCcw size={17} /> 초기화</button>
      <button className="secondary-button" onClick={onPdf}><Download size={17} /> PDF</button>
      <button className="primary-button" disabled={!dirty} onClick={onSave}><Save size={17} /> 저장</button>
    </>
  );
}

function BottomSaveAction({ dirty, onSave }) {
  return (
    <div className="bottom-save-actions">
      <button className="primary-button" disabled={!dirty} onClick={onSave}><Save size={17} /> 저장</button>
    </div>
  );
}

function NumberInput({ value, onChange }) {
  return <input className="number-input" inputMode="decimal" value={numberOrEmpty(value)} onChange={(event) => onChange(event.target.value)} />;
}

function PriceBadge({ state }) {
  if (state === 'up') return <span className="price up">상승</span>;
  if (state === 'down') return <span className="price down">하락</span>;
  if (state === 'same') return <span className="price same">동일</span>;
  return <span className="price muted">-</span>;
}

function priceDirection(prev, current) {
  if (current === null || current === '' || current === undefined || prev === null || prev === '' || prev === undefined) return 'none';
  if (Number(current) > Number(prev)) return 'up';
  if (Number(current) < Number(prev)) return 'down';
  return 'same';
}

function useSettingsUnitOptions() {
  const [options, setOptions] = useState({});
  useEffect(() => {
    api('/api/settings/ingredients')
      .then((data) => {
        const grouped = {};
        data.unitOptions.forEach((option) => {
          grouped[option.unit] ||= [];
          grouped[option.unit].push(option.value);
        });
        setOptions(grouped);
      })
      .catch(() => setOptions({}));
  }, []);
  return options;
}

function LoadingCard() {
  return <section className="form-card">불러오는 중입니다.</section>;
}

async function exportPdf(ref, title) {
  if (!ref.current) return;
  const canvas = await html2canvas(ref.current, { scale: 2, backgroundColor: '#ffffff' });
  const pdf = new jsPDF('p', 'mm', 'a4');
  const width = 210;
  const height = (canvas.height * width) / canvas.width;
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height);
  pdf.save(`${title}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

createRoot(document.getElementById('root')).render(<App />);
