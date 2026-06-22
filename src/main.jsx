import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ClipboardCheck,
  Download,
  ListChecks,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import './styles.css';

const TTL_MS = 60 * 60 * 1000;
const STORAGE_KEY = 'shinkal-checklist-cache-v3';
const EXPORT_CONTENT_WIDTH = 1100;
const EXPORT_CONTENT_HEIGHT = 1500;

const checklistPages = [
  {
    id: 1,
    phase: '오픈',
    title: '매장 오픈 [홀]',
    subtitle: '홀 운영에 필요한 준비 사항을 순서대로 점검합니다.',
    roleHint: '홀 메인 / 홀 서브 / 홀 서서브',
    roles: ['홀 메인', '홀 서브', '홀 서서브'],
    sections: [
      section('외부/전원', [
        '에어컨팬, 배너 및 외부 청결 상태 확인',
        '포스기 전원 순번대로 ON 및 정상작동 확인',
        'TV 켜고 매장 음악 위주로 재생 확인',
        '태블릿 사용 준비 확인',
        '화장실 상태 및 비품 확인',
      ]),
      section('청소/카트', [
        '바닥 청소',
        '행주 세척 후 빠르게 짜기',
        '행주 용도 구분 및 테이블, 소스통, 쟁반 마무리',
        '소독 분무기와 행주 2개를 1세트로 카트 세팅',
        '수족관 램프 ON 여부',
      ]),
      section('냉장/김치', [
        '쇼케이스 램프 ON 여부',
        '냉장고, 보온고 전원 ON 여부',
        '매운 김치와 안매운 김치가 섞이지 않게 적정량 세팅',
        '배달 김치 적정량 세팅',
        '장류를 이물질 없이 적정량 세팅',
      ]),
      section('비품/외관', [
        '고추 세팅',
        '단무지 세팅',
        '김가루와 닭가슴살 세팅',
        '배달 비품 종류별 여유분까지 확인 및 세팅',
        '유리 및 매장 외관상 체크 후 닦기',
      ]),
    ],
  },
  {
    id: 2,
    phase: '오픈',
    title: '매장 오픈 [주방 서브]',
    subtitle: '주방 서브 포지션 오픈 준비를 점검합니다.',
    roleHint: '주방 서브 / 주방 서서브',
    roles: ['주방 서브', '주방 서서브'],
    sections: [
      section('식자재/밥', [
        '식자재 정리 상태 확인 후 다 함께 진행',
        '밥 짓기 비율과 방향 매뉴얼 준수',
        '중탕기 및 만두 찜기 물 채움 후 120도 10분 타이머 진행',
        '삼계 바트 1/2 미리 세팅',
        '약재물 끓이기 전 대추와 여유바트 확인',
      ]),
      section('삼계/사이드', [
        '삼계 작업 시간 기준 준수',
        '만두 시스댐 세팅 수량 확인',
        '쥬키니, 대파 등 야채 선입선출 진행',
        '곰탕 삼계 재료 준비',
        '하계 운영 시 김치말이 재료 선입선출 준비',
      ]),
      section('마무리 세팅', [
        '얼큰 가루 여유바트까지 세팅',
        '삼계와 곰탕 약재물이 넘치지 않게 세팅',
        '15족 이상 삼계는 채반 이용해 세팅',
        '수육 작업 시 기준 중량 준수',
        '배달 밥 15개 이상 먼저 담고 홀 밥 세팅',
      ]),
    ],
  },
  {
    id: 3,
    phase: '오픈',
    title: '매장 오픈 [주방 메인]',
    subtitle: '주방 메인 포지션의 오픈 준비를 점검합니다.',
    roleHint: '주방 메인',
    roles: ['주방 메인'],
    sections: [
      section('반죽/세척', [
        '반죽 상태 확인 후 선입선출 진행',
        '배추 헹굼 시 돌려가며 2회 진행 후 10분 타이머 설정',
        '세척기 물 원위치 및 매장 운영 가능하도록 물 채움',
        '계절메뉴 육수 세팅 시 육수 상태와 세팅값 확인',
      ]),
      section('육수/김치', [
        '4번 육수 농도 확인 후 기준에 맞게 조절',
        '화구 불 확인 후 바깥불 강불, 안불 약불로 조절',
        '김치 1차 버무림 시 고춧가루가 뭉치지 않게 진행',
        '반죽 상태 확인 후 한 판 얇게 밀어 봉함',
      ]),
      section('버무림/보관', [
        '김치 2차 버무림 시 5분 이상 양념이 뭉치지 않게 진행',
        '오픈간 홀에서 사용할 김치를 제외하고 작업 김치 보관',
        '당일 사용할 닭 육수 분말과 후추 세팅',
        '나머지 반죽을 계절 기준에 맞게 밀어 봉함',
      ]),
    ],
  },
  {
    id: 4,
    phase: '운영',
    title: '매장 운영 [홀 - 메인]',
    subtitle: '홀 메인 담당자의 운영 중 역할을 점검합니다.',
    roleHint: '홀 메인',
    roles: [],
    sections: [
      section('기본 업무', [
        '모니터 확인 후 주방 서브와 소통',
        '주메뉴와 배차 여부를 주방 서브와 소통',
        '반찬 세팅을 김치, 단무지, 고추, 장류, 앞접시, 공기밥 순으로 진행',
        '주방 서브와 소통하여 메인 메뉴 1분 전 사이드 먼저 준비',
        '메인 메뉴 챙길 시 닭칼국수 토핑을 일자로 진행',
      ]),
      section('배달 업무', [
        '배달 들어왔을 시 빌지 부착 후 리뷰, 음료 등 특이사항 확인',
        '맨 아래 빌지부터 폴더에 끼운 뒤 좌측부터 차례로 세팅',
      ]),
      section('서빙 업무', [
        '서빙 시 자리로 이동 후 “식사 나왔습니다” 멘트와 미소 진행',
        '어른, 아이 순으로 메인, 사이드, 반찬 순서를 지켜 서빙',
        '서빙 마무리 시 안매운 김치 멘트와 “맛있게 드세요” 진행',
      ]),
    ],
  },
  {
    id: 5,
    phase: '운영',
    title: '매장 운영 [홀 - 서브]',
    subtitle: '홀 서브 담당자의 응대와 정리 흐름을 점검합니다.',
    roleHint: '홀 서브',
    roles: [],
    sections: [
      section('고객 맞이', ['“어서오세요 현풍닭칼국수입니다.” 인사 멘트를 큰 목소리와 미소로 선창']),
      section('주문/서비스', ['정중하게 자리 안내 후 물 제공', '고객의 주문 확인을 한 번 더 확인']),
      section('반찬 리필', ['반찬 리필에 필요한 반찬과 집기를 먼저 챙긴 뒤 이동', '반찬 리필 의사를 물어본 뒤 소량 리필 진행']),
      section('마무리/정리', ['소스통 원위치 후 다음 단계 진행', '물과 빌지를 카트에 싣고 다음 단계 진행', '잔반 처리 시 메인 그릇에 8부 이상 담지 않기', '같은 크기의 그릇끼리 모아 설거지대 이동']),
      section('포스기', ['포스기 운영 능력이 양호한지 확인']),
    ],
  },
  {
    id: 6,
    phase: '운영',
    title: '매장 운영 [홀 - 서서브]',
    subtitle: '홀 서서브 담당자의 서빙과 정리 역할을 점검합니다.',
    roleHint: '홀 서서브',
    roles: [],
    sections: [
      section('고객 맞이/서빙', ['서브가 인사멘트 선창할 시 큰 목소리로 후창', '서빙 시 자리로 이동 후 “식사 나왔습니다” 진행', '어른, 아이 순으로 메인, 사이드, 반찬 순서를 지켜 서빙', '서빙 마무리 시 “맛있게 드세요” 진행']),
      section('마무리/정리', ['소스통 원위치 후 다음 단계 진행', '물과 빌지를 카트에 싣고 다음 단계 진행', '잔반 처리 시 메인 그릇에 8부 이상 담지 않기', '같은 크기의 그릇끼리 모아 설거지대 이동']),
      section('반찬 리필', ['반찬 리필에 필요한 반찬과 집기를 먼저 챙긴 뒤 이동', '반찬 리필 의사를 물어본 뒤 소량 리필 진행']),
    ],
  },
  {
    id: 7,
    phase: '운영',
    title: '매장 운영 [주방 메인]',
    subtitle: '주방 메인의 면 삶기, 육수, 피크 운영을 점검합니다.',
    roleHint: '주방 메인',
    roles: [],
    sections: [
      section('기본 운영', ['고객 입점 시 모니터 확인 후 1, 2, 3번 술 불 확인', '바깥불 강불, 안불 약불로 진행', '베이스 상태에 따라 밀가루 양 조절', '제면 시 면의 1/3 기준에 맞춰 넣기']),
      section('면 삶기/컷팅', ['뭉친 면 없이 면 젓기 매뉴얼 준수', '면이 끓고 전체적으로 저은 뒤 3분 30초 타이머 진행', '면 컷팅 전 면 익힘 상태 확인', '면 컷팅 속도 및 정량 확인']),
      section('육수/기타', ['8인분 면 컷팅 전 2, 3번 술 육수 희석 진행', '1번 술 육수 희석 운영 시 매뉴얼 유지', '배달 면 20초 남았을 시 컷팅 진행', '피크타임 기준 반죽을 미리 꺼내 운영']),
    ],
  },
  {
    id: 8,
    phase: '운영',
    title: '매장 운영 [주방 서브]',
    subtitle: '주방 서브의 모니터 소통과 사이드 매뉴얼 준수를 점검합니다.',
    roleHint: '주방 서브',
    roles: [],
    sections: [
      section('기본 운영', ['가장 먼저 모니터 확인 후 홀 메인과 소통', '칼국수 4종류를 하나로 보아 수량과 테이블 번호 소통', '사이드 메뉴는 면 컷팅 1분 전 빼주기']),
      section('사이드 메뉴', ['사이드 만두 매뉴얼 준수', '사이드 곰탕 매뉴얼 준수', '사이드 삼계 매뉴얼 준수', '사이드 수육 매뉴얼 준수']),
      section('지원 업무', ['여유바트 교체 시 항상 새 바트로 교체', '메뉴 빼주기 전 1번 육수 확인 후 채움', '1번 육수 채운 뒤 모니터 확인 및 설거지 지원']),
    ],
  },
  {
    id: 9,
    phase: '운영',
    title: '매장 운영 [주방 서서브]',
    subtitle: '주방 서서브의 소통, 사이드, 정리 지원을 점검합니다.',
    roleHint: '주방 서서브',
    roles: [],
    sections: [
      section('기본 운영', ['들어온 메뉴를 주방 서브와 소통', '김치말이 메뉴 소면 인분 기준 확인', '면 투하 후 칼국수와 동일하게 저어 4분 타이머 설정']),
      section('서브 운영', ['지원 후 다시 재역할 수행 자리로 복귀', '사이드 메뉴는 서브와 소통하여 면 컷팅 1분 전 빼주기', '사이드 만두 매뉴얼 준수']),
      section('사이드/정리', ['사이드 곰탕 매뉴얼 준수', '사이드 삼계 매뉴얼 준수', '여유바트 교체 시 항상 새 바트로 교체', '설거지 시 큰 그릇은 아래에 정리하고 같은 크기끼리 모으기']),
    ],
  },
  {
    id: 10,
    phase: '마감',
    title: '매장 마감 [홀]',
    subtitle: '홀 운영 마감에 필요한 사항을 순서대로 점검합니다.',
    roleHint: '홀 메인 / 홀 서브 / 홀 서서브',
    roles: ['홀 메인', '홀 서브', '홀 서서브'],
    sections: [
      section('테이블/비품', ['19시 30분 수저 닦기 매뉴얼 준수', '쇼케이스 램프 OFF 및 음료, 주류 채우기', '셀프바 성에 제거 후 얼룩 없이 닦기', '그릇 기물 셀프바부터 홀 점오바 순으로 채우기', '마지막 상 치울 시 홀 기물을 설거지대에 이동']),
      section('청소/랩핑', ['화장실 청소', '홀 쓰레기통 분리수거 후 봉투 교체', '카트 마무리 및 쟁반 말려놓기', '식자재 랩핑 십자로 진행', '반찬 마감 후 랩핑하여 냉장고 보관']),
      section('김치/수족관', ['김치 마감 시 매운 김치와 안매운 김치가 섞이지 않게 담기', '김치 선입선출 가능하도록 라벨지 작업', '수족관 램프 OFF 여부', '김치 포장용기 씻어 엎어두기', '보온고 마감 시 전원 OFF']),
      section('전원/외관', ['익일 사용 가능하도록 태블릿 충전', '익일 바닥 청소 가능하도록 의자 올리기', 'TV, 에어컨 또는 히터 OFF 여부', '에어간판 OFF 및 고정 여부', '포스 마감 후 노래 OFF 여부']),
    ],
  },
  {
    id: 11,
    phase: '마감',
    title: '매장 마감 [주방 메인]',
    subtitle: '주방 메인의 마감 청소와 최종 점검을 확인합니다.',
    roleHint: '주방 메인',
    roles: ['주방 메인'],
    sections: [
      section('화구/세척', ['메인 화구 선반과 배식대를 위에서 아래로 닦기', '그을린 부분 없이 술 세척 진행', '술 교체 시 잔면을 걸러 시간 간격으로 진행', '20시 이후 소금에 절인 배추 위아래 뒤집기']),
      section('반죽/보관', ['튀김은 배추에 타공 바구니 얹어두기', '남은 반죽의 밀가루를 털어 뭉친 후 밀어두기', '반죽 밀봉 후 냉장 보관 시 위아래 위치 변경', '7번 단계 진행 후 반죽 넣어두기']),
      section('전원/최종', ['베이스를 센 불로 끓인 후 불 끄고 뚜껑 덮기', '보일러와 가스 OFF 여부 확인', '시재와 포스 마감 시 현금 확인', '반죽상태, 온도, 가스, 보일러, 세척기 전원 최종 점검']),
    ],
  },
  {
    id: 12,
    phase: '마감',
    title: '매장 마감 [주방 서브]',
    subtitle: '주방 서브 마감 청소와 익일 준비 상태를 점검합니다.',
    roleHint: '주방 서브 / 주방 서서브',
    roles: ['주방 서브', '주방 서서브'],
    sections: [
      section('선반/랩핑', ['주방 선반 닦을 시 식재료 바트 뚜껑 교체와 함께 위에서 아래로 닦기', '야채와 닭육수 랩핑을 십자로 진행하고 상태 확인', '행주 세척 및 삶을 시 이물질 제거 후 진행']),
      section('만두/찜기', ['당일 남은 만두를 익일 사용할 밀폐용기에 해동 준비', '약재물과 삼계 바트를 옆으로 빼두기', '중탕기와 만두찜기 세척 시 기름기 없이 세척']),
      section('물청소/익일 준비', ['물청소', '중탕기 2, 3, 4 순번대로 진행', '콘센트 코드에 물이 닿지 않도록 선반다리와 맨밑 선반까지 청소', '랩핑은 반드시 십자로 진행하고 익일 사용할 당면까지 불려놓기']),
    ],
  },
];

function section(title, items) {
  return { title, items };
}

const phaseClass = {
  오픈: 'phase-open',
  운영: 'phase-run',
  마감: 'phase-close',
};

function getItems(page) {
  return page.sections.flatMap((sectionValue) => sectionValue.items);
}

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
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...next, expiresAt: Date.now() + TTL_MS }),
  );
}

function pageState(cache, pageId) {
  return cache.pages[pageId] || { positionNames: {}, checks: {} };
}

function checkedCount(state) {
  return Object.values(state.checks || {}).filter(Boolean).length;
}

function scoreLabel(score, total) {
  const ratio = total ? score / total : 0;
  if (score === total) return '완료';
  if (ratio >= 0.85) return '우수';
  if (ratio >= 0.6) return '진행중';
  return '점검 필요';
}

function App() {
  const [selectedId, setSelectedId] = useState(1);
  const [cache, setCache] = useState(readCache);
  const [exporting, setExporting] = useState(false);
  const exportRefs = useRef({});

  const selectedPage = useMemo(
    () => checklistPages.find((page) => page.id === selectedId) || checklistPages[0],
    [selectedId],
  );
  const selectedState = pageState(cache, selectedId);

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
      return {
        ...current,
        global: { ...current.global, date: '', manager: '' },
        pages: nextPages,
      };
    });
  }

  async function exportPdf() {
    setExporting(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [EXPORT_CONTENT_WIDTH, EXPORT_CONTENT_HEIGHT],
      });
      pdf.setDisplayMode('50%', 'continuous', 'UseNone');

      for (const [index, page] of checklistPages.entries()) {
        const node = exportRefs.current[page.id];
        const canvas = await html2canvas(node, {
          backgroundColor: '#f7f5ef',
          width: EXPORT_CONTENT_WIDTH,
          height: EXPORT_CONTENT_HEIGHT,
          windowWidth: EXPORT_CONTENT_WIDTH,
          windowHeight: EXPORT_CONTENT_HEIGHT,
          scale: 2,
          useCORS: true,
        });
        const image = canvas.toDataURL('image/jpeg', 0.94);
        if (index > 0) pdf.addPage([EXPORT_CONTENT_WIDTH, EXPORT_CONTENT_HEIGHT], 'portrait');
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
      <TopBar
        cache={cache}
        page={selectedPage}
        state={selectedState}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        updateGlobal={updateGlobal}
        updatePage={updatePage}
        resetCurrentPage={resetCurrentPage}
      />

      <div className="workspace">
        <ChecklistView
          page={selectedPage}
          data={selectedState}
          global={cache.global}
          onToggle={toggleCheck}
        />

        <Inspector
          page={selectedPage}
          data={selectedState}
          global={cache.global}
          onExport={exportPdf}
          exporting={exporting}
        />
      </div>

      <div className="export-stage" aria-hidden="true">
        {checklistPages.map((page) => {
          const data = pageState(cache, page.id);
          return (
            <div
              key={page.id}
              className="export-page"
              ref={(node) => {
                if (node) exportRefs.current[page.id] = node;
              }}
            >
              <ChecklistView page={page} data={data} global={cache.global} exportMode />
            </div>
          );
        })}
      </div>
    </main>
  );
}

function TopBar({
  cache,
  page,
  state,
  selectedId,
  setSelectedId,
  updateGlobal,
  updatePage,
  resetCurrentPage,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><ClipboardCheck size={22} /></span>
        <div>
          <p>SHIN KAL</p>
          <strong>운영 체크리스트</strong>
        </div>
      </div>

      <label className="control control-wide">
        <span>체크리스트</span>
        <select value={selectedId} onChange={(event) => setSelectedId(Number(event.target.value))}>
          {checklistPages.map((pageOption) => (
            <option key={pageOption.id} value={pageOption.id}>
              {pageOption.id}. {pageOption.title}
            </option>
          ))}
        </select>
      </label>

      <DatePickerButton
        value={cache.global.date}
        onChange={(value) => updateGlobal('date', value)}
      />
      <LabeledInput
        icon={<UserRound size={17} />}
        label="담당자"
        value={cache.global.manager}
        placeholder="이름"
        onChange={(value) => updateGlobal('manager', value)}
      />

      <button type="button" className="icon-button danger" onClick={resetCurrentPage}>
        <RotateCcw size={18} />
        <span>초기화</span>
      </button>

      <RoleInputs
        page={page}
        state={state}
        updatePage={updatePage}
      />
    </header>
  );
}

function DatePickerButton({ value, onChange }) {
  const inputRef = useRef(null);

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.click();
    }
  }

  return (
    <div className="control date-control">
      <span>날짜</span>
      <button type="button" className="date-button" onClick={openPicker}>
        <CalendarDays size={18} />
        <strong>{value || '날짜 선택'}</strong>
      </button>
      <input
        ref={inputRef}
        className="native-date-input"
        type="date"
        value={value}
        tabIndex={-1}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function RoleInputs({ page, state, updatePage }) {
  if (!page.roles?.length) {
    return (
      <div className="role-empty">
        <ListChecks size={17} />
        <span>이 체크리스트는 별도 담당포지션 입력이 없습니다.</span>
      </div>
    );
  }

  return (
    <div className="role-grid">
      {page.roles.map((role) => (
        <label className="role-field" key={role}>
          <span>{role}</span>
          <input
            value={state.positionNames?.[role] || ''}
            placeholder={`${role} 이름`}
            onChange={(event) => updatePage(page.id, (current) => ({
              ...current,
              positionNames: {
                ...(current.positionNames || {}),
                [role]: event.target.value,
              },
            }))}
          />
        </label>
      ))}
    </div>
  );
}

function LabeledInput({ icon, label, value, placeholder, onChange }) {
  return (
    <label className="control">
      <span>{icon}{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ChecklistView({ page, data, global, onToggle, exportMode = false }) {
  const total = getItems(page).length;
  const score = checkedCount(data);
  let offset = 0;

  return (
    <section className={`checklist ${exportMode ? 'export-mode' : ''}`}>
      <div className="page-hero">
        <div>
          <span className={`phase ${phaseClass[page.phase]}`}>{page.phase}</span>
          <h1>{page.title}</h1>
          <p>{page.subtitle}</p>
        </div>
      </div>

      <div className="meta-strip">
        <Meta label="날짜" value={global.date || '-'} />
        <Meta label="담당자" value={global.manager || '-'} />
        <Meta label="담당포지션" value={formatRoles(page, data)} />
        <Meta label="상태" value={scoreLabel(score, total)} />
      </div>

      <div className="sections">
        {page.sections.map((sectionValue) => {
          const base = offset;
          offset += sectionValue.items.length;
          const sectionScore = sectionValue.items.reduce(
            (sum, _item, index) => sum + (data.checks?.[base + index] ? 1 : 0),
            0,
          );

          return (
            <section className="section-block" key={sectionValue.title}>
              <div className="section-head">
                <h2>{sectionValue.title}</h2>
                <span>{sectionScore} / {sectionValue.items.length}</span>
              </div>
              <div className="item-list">
                {sectionValue.items.map((item, index) => {
                  const itemIndex = base + index;
                  const checked = Boolean(data.checks?.[itemIndex]);
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`check-row ${checked ? 'is-checked' : ''}`}
                      onClick={() => !exportMode && onToggle?.(itemIndex)}
                    >
                      <span className="check-box">{checked && <Check size={18} strokeWidth={3} />}</span>
                      <span className="item-number">{itemIndex + 1}</span>
                      <span className="item-text">{item}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function Meta({ label, value }) {
  return (
    <div className="meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRoles(page, data) {
  if (!page.roles?.length) return '해당 없음';
  return page.roles
    .map((role) => `${role}: ${data.positionNames?.[role] || '-'}`)
    .join(' · ');
}

function Inspector({ page, data, global, onExport, exporting }) {
  const items = getItems(page);
  const score = checkedCount(data);
  const missed = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !data.checks?.[index]);

  return (
    <aside className="inspector">
      <div className="inspector-panel">
        <div className="ring" style={{ '--value': `${items.length ? (score / items.length) * 100 : 0}%` }}>
          <span>{score}</span>
          <small>{items.length}점</small>
        </div>
        <h2>{scoreLabel(score, items.length)}</h2>
        <p>{global.date || '날짜 미입력'} · {global.manager || '담당자 미입력'}</p>
      </div>

      <div className="inspector-panel">
        <div className="panel-title">
          <AlertCircle size={18} />
          <h2>누락 항목</h2>
        </div>
        {missed.length ? (
          <ol className="missed-list">
            {missed.slice(0, 8).map(({ item, index }) => (
              <li key={item}><span>{index + 1}</span>{item}</li>
            ))}
          </ol>
        ) : (
          <p className="empty">현재 페이지가 모두 완료되었습니다.</p>
        )}
      </div>

      <button type="button" className="export-action" onClick={onExport} disabled={exporting}>
        <Download size={19} />
        {exporting ? 'PDF 생성 중' : '전체 12페이지 내보내기'}
      </button>
    </aside>
  );
}

createRoot(document.getElementById('root')).render(<App />);
