import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import './styles.css';

const TTL_MS = 60 * 60 * 1000;
const STORAGE_KEY = 'shinkal-checklist-cache-v1';

const pages = [
  {
    id: 1,
    title: '매장 오픈 [홀]',
    image: '/checklists/page-01.png',
    cleanPositionArea: true,
    checks: [
      [0.2337, 0.4724], [0.469, 0.4724], [0.7116, 0.4724], [0.953, 0.4724],
      [0.2337, 0.5348], [0.4688, 0.5348], [0.7116, 0.5348], [0.953, 0.5348],
      [0.2337, 0.6016], [0.4692, 0.6012], [0.7116, 0.6016], [0.953, 0.6016],
      [0.2337, 0.6749], [0.4688, 0.6749], [0.7116, 0.6749], [0.953, 0.6749],
      [0.2337, 0.7522], [0.469, 0.7522], [0.7116, 0.7522], [0.953, 0.7522],
    ],
  },
  {
    id: 2,
    title: '매장 오픈 [주방 서브]',
    image: '/checklists/page-02.png',
    cleanPositionArea: true,
    checks: [
      [0.3024, 0.43], [0.6133, 0.4289], [0.9465, 0.4289],
      [0.3024, 0.5137], [0.6133, 0.5332], [0.9465, 0.5119],
      [0.3024, 0.6061], [0.6133, 0.6051], [0.9465, 0.5935],
      [0.3024, 0.6863], [0.6133, 0.6827], [0.9465, 0.6783],
      [0.3024, 0.7643], [0.6133, 0.7617], [0.9465, 0.761],
    ],
  },
  {
    id: 3,
    title: '3페이지 체크리스트',
    image: '/checklists/page-03.png',
    checks: [
      [0.3022, 0.43], [0.6132, 0.4296], [0.9474, 0.43],
      [0.3025, 0.5209], [0.6132, 0.5372], [0.9476, 0.5177],
      [0.3025, 0.6224], [0.6137, 0.6523], [0.9476, 0.6495],
      [0.3025, 0.7321], [0.6134, 0.7646], [0.9476, 0.7343],
    ],
  },
  {
    id: 4,
    title: '4페이지 체크리스트',
    image: '/checklists/page-04.png',
    checks: [
      [0.4666, 0.3666], [0.9559, 0.3604],
      [0.4666, 0.4676], [0.9559, 0.4351],
      [0.4666, 0.5554], [0.9559, 0.6181],
      [0.4666, 0.6593], [0.9559, 0.6939],
      [0.4666, 0.7587], [0.9559, 0.769],
    ],
  },
  {
    id: 5,
    title: '매장 운영 [홀 - 서브]',
    image: '/checklists/page-05.png',
    checks: [
      [0.4614, 0.3585], [0.9527, 0.3585],
      [0.4614, 0.4953], [0.9527, 0.426],
      [0.4614, 0.5537], [0.9527, 0.4985],
      [0.4614, 0.7148], [0.9527, 0.5704],
      [0.4614, 0.7765], [0.9527, 0.7362],
    ],
  },
  {
    id: 6,
    title: '매장 운영 [홀 - 서서브]',
    image: '/checklists/page-06.png',
    checks: [
      [0.3149, 0.3783], [0.6411, 0.3783], [0.9606, 0.3783],
      [0.3149, 0.47], [0.6411, 0.4747], [0.9606, 0.4827],
      [0.3149, 0.5884], [0.6411, 0.5639], [0.9606, 0.607],
      [0.3149, 0.7105],
    ],
  },
  {
    id: 7,
    title: '7페이지 체크리스트',
    image: '/checklists/page-07.png',
    checks: [
      [0.314, 0.3755], [0.6301, 0.3755], [0.952, 0.3762],
      [0.314, 0.478], [0.6301, 0.4773], [0.952, 0.4773],
      [0.314, 0.5827], [0.6301, 0.6181], [0.952, 0.6451],
      [0.314, 0.7415], [0.6301, 0.7549], [0.952, 0.7336],
    ],
  },
  {
    id: 8,
    title: '8페이지 체크리스트',
    image: '/checklists/page-08.png',
    checks: [
      [0.3108, 0.4075], [0.6285, 0.4075], [0.9525, 0.4075],
      [0.3108, 0.5306], [0.6285, 0.532], [0.9525, 0.5317],
      [0.3108, 0.7311], [0.6285, 0.6551], [0.9525, 0.6994],
      [0.6288, 0.7718],
    ],
  },
  {
    id: 9,
    title: '9페이지 체크리스트',
    image: '/checklists/page-09.png',
    checks: [
      [0.3117, 0.3739], [0.6289, 0.3746], [0.9523, 0.3714],
      [0.3117, 0.5058], [0.6289, 0.5164], [0.9523, 0.4651],
      [0.3117, 0.6595], [0.6289, 0.6566], [0.9523, 0.569],
      [0.9523, 0.6762],
    ],
  },
  {
    id: 10,
    title: '10페이지 체크리스트',
    image: '/checklists/page-10.png',
    checks: [
      [0.2343, 0.4827], [0.4684, 0.4823], [0.7117, 0.4827], [0.953, 0.4823],
      [0.2343, 0.5549], [0.4684, 0.5552], [0.7119, 0.5552], [0.953, 0.5552],
      [0.2343, 0.6292], [0.4684, 0.6292], [0.7117, 0.6292], [0.953, 0.6292],
      [0.2343, 0.6982], [0.4684, 0.6982], [0.7117, 0.6982], [0.953, 0.6982],
      [0.2343, 0.7653], [0.4684, 0.7653], [0.7117, 0.7653], [0.953, 0.7653],
    ],
  },
  {
    id: 11,
    title: '11페이지 체크리스트',
    image: '/checklists/page-11.png',
    checks: [
      [0.2375, 0.5047], [0.4705, 0.5004], [0.7134, 0.4946], [0.9538, 0.5255],
      [0.2378, 0.5959], [0.4705, 0.5909], [0.7134, 0.6469], [0.9538, 0.6979],
      [0.2378, 0.6756], [0.4705, 0.6756], [0.2375, 0.7554], [0.4705, 0.7579],
    ],
  },
  {
    id: 12,
    title: '12페이지 체크리스트',
    image: '/checklists/page-12.png',
    checks: [
      [0.2967, 0.496], [0.6133, 0.4971], [0.9533, 0.4892],
      [0.2967, 0.6355], [0.6133, 0.628], [0.9531, 0.5671],
      [0.2967, 0.7603], [0.6133, 0.7516], [0.9533, 0.6528],
      [0.9533, 0.7495],
    ],
  },
];

function freshCache() {
  return {
    expiresAt: Date.now() + TTL_MS,
    global: { date: '', manager: '' },
    pages: {},
  };
}

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return freshCache();
    }
    return {
      ...freshCache(),
      ...parsed,
      global: { date: '', manager: '', ...(parsed.global || {}) },
      pages: parsed.pages || {},
    };
  } catch {
    return freshCache();
  }
}

function writeCache(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...next,
    expiresAt: Date.now() + TTL_MS,
  }));
}

function pageState(cache, pageId) {
  return cache.pages[pageId] || { position: '', checks: {} };
}

function checkedCount(state) {
  return Object.values(state.checks || {}).filter(Boolean).length;
}

function App() {
  const [selectedId, setSelectedId] = useState(1);
  const [cache, setCache] = useState(readCache);
  const [exporting, setExporting] = useState(false);
  const exportRefs = useRef({});

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedId) || pages[0],
    [selectedId],
  );
  const selectedState = pageState(cache, selectedId);
  const score = checkedCount(selectedState);

  useEffect(() => {
    writeCache(cache);
  }, [cache]);

  function updateGlobal(field, value) {
    setCache((current) => ({
      ...current,
      global: { ...current.global, [field]: value },
    }));
  }

  function updatePage(pageId, updater) {
    setCache((current) => {
      const currentPage = pageState(current, pageId);
      return {
        ...current,
        pages: {
          ...current.pages,
          [pageId]: updater(currentPage),
        },
      };
    });
  }

  function toggleCheck(index) {
    updatePage(selectedId, (current) => ({
      ...current,
      checks: {
        ...current.checks,
        [index]: !current.checks?.[index],
      },
    }));
  }

  function resetCurrentPage() {
    setCache((current) => {
      const nextPages = { ...current.pages };
      delete nextPages[selectedId];
      return { ...current, pages: nextPages };
    });
  }

  async function waitForImages(container) {
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }));
  }

  async function exportPdf() {
    setExporting(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 860] });

      for (const [index, page] of pages.entries()) {
        const node = exportRefs.current[page.id];
        await waitForImages(node);
        const canvas = await html2canvas(node, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
        });
        const image = canvas.toDataURL('image/jpeg', 0.92);
        if (index > 0) {
          pdf.addPage([canvas.width, canvas.height], 'landscape');
        }
        const width = pdf.internal.pageSize.getWidth();
        const height = pdf.internal.pageSize.getHeight();
        pdf.addImage(image, 'JPEG', 0, 0, width, height);
      }

      const today = new Date().toISOString().slice(0, 10);
      pdf.save(`shinkal-checklist-${today}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="app">
      <header className="toolbar">
        <div className="field page-field">
          <label htmlFor="page">체크리스트</label>
          <select
            id="page"
            value={selectedId}
            onChange={(event) => setSelectedId(Number(event.target.value))}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.id}. {page.title} ({page.checks.length}점)
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="date">날짜</label>
          <input
            id="date"
            type="text"
            placeholder="예: 2026-06-22"
            value={cache.global.date}
            onChange={(event) => updateGlobal('date', event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="manager">담당자</label>
          <input
            id="manager"
            type="text"
            placeholder="이름 입력"
            value={cache.global.manager}
            onChange={(event) => updateGlobal('manager', event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="position">담당포지션</label>
          <input
            id="position"
            type="text"
            placeholder="포지션 입력"
            value={selectedState.position || ''}
            onChange={(event) => updatePage(selectedId, (current) => ({
              ...current,
              position: event.target.value,
            }))}
          />
        </div>

        <div className="score-chip" aria-live="polite">
          {score} / {selectedPage.checks.length}
        </div>

        <button className="reset-button" type="button" onClick={resetCurrentPage}>
          초기화
        </button>
      </header>

      <section className="sheet-scroll" aria-label="체크리스트 작성 영역">
        <ChecklistSheet
          page={selectedPage}
          data={selectedState}
          global={cache.global}
          score={score}
          onToggle={toggleCheck}
          onExport={exportPdf}
          exporting={exporting}
        />
      </section>

      <div className="export-stage" aria-hidden="true">
        {pages.map((page) => {
          const data = pageState(cache, page.id);
          return (
            <div
              key={page.id}
              className="export-page"
              ref={(node) => {
                if (node) exportRefs.current[page.id] = node;
              }}
            >
              <ExportHeader page={page} data={data} global={cache.global} />
              <ChecklistSheet
                page={page}
                data={data}
                global={cache.global}
                score={checkedCount(data)}
                exportMode
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}

function ExportHeader({ page, data, global }) {
  return (
    <div className="export-header">
      <strong>{page.id}. {page.title}</strong>
      <span>날짜: {global.date || '-'}</span>
      <span>담당자: {global.manager || '-'}</span>
      <span>담당포지션: {data.position || '-'}</span>
      <span>총점: {checkedCount(data)} / {page.checks.length}</span>
    </div>
  );
}

function ChecklistSheet({
  page,
  data,
  global,
  score,
  onToggle,
  onExport,
  exporting = false,
  exportMode = false,
}) {
  return (
    <div className={`sheet ${exportMode ? 'sheet-export' : ''}`}>
      <img className="sheet-image" src={page.image} alt={`${page.title} 원본`} draggable="false" />

      <div className="meta-cover date-cover">
        <span>{global.date}</span>
      </div>
      <div className="meta-cover manager-cover">
        <span>{global.manager}</span>
      </div>
      <div className="meta-cover score-cover">
        <span>{score}</span>
        <span>/ {page.checks.length}</span>
      </div>

      {page.cleanPositionArea && (
        <div className="position-cover">
          <span className="position-label">담당포지션</span>
          <span className="position-value">{data.position || ''}</span>
        </div>
      )}

      {page.checks.map(([x, y], index) => {
        const checked = Boolean(data.checks?.[index]);
        if (exportMode) {
          return (
            <span
              key={index}
              className={`check-toggle export-check ${checked ? 'checked' : ''}`}
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            />
          );
        }
        return (
          <button
            key={index}
            className={`check-toggle ${checked ? 'checked' : ''}`}
            type="button"
            aria-label={`${index + 1}번 항목 ${checked ? '체크 해제' : '체크'}`}
            aria-pressed={checked}
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            onClick={() => onToggle(index)}
          />
        );
      })}

      <div className="bottom-total-cover">
        {!exportMode && (
          <button className="export-button" type="button" onClick={onExport} disabled={exporting}>
            {exporting ? 'PDF 생성 중' : '내보내기'}
          </button>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
