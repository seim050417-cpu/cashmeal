require('dotenv').config();
const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const API1_ENDPOINT = 'https://apis.data.go.kr/1390803/nics/AgriFood/MzenFoodCode1/getKoreanFoodList1';
const API2_ENDPOINT = 'https://apis.data.go.kr/1390803/AgriFood/MzenFoodNutri1/getKoreanFoodIdntList1';

app.use(express.static(path.join(__dirname, 'public')));

function hasKey() {
  const key = process.env.RDA_SERVICE_KEY;
  return !!key && !key.includes('여기에');
}

/**
 * 공공데이터포털 서비스키 정규화.
 * - 앞뒤 공백 제거
 * - 이미 percent-encoding(Encoding 키)된 상태라면 한 번 decode해서 "순수 원본 문자열"로 되돌린다.
 * - Decoding 키(원본 그대로)라면 애초에 %XX 패턴이 없으므로 그대로 둔다.
 * - 이후 axios의 params 옵션에 이 "원본 문자열"을 넘기면 axios가 요청 시 정확히 한 번만 인코딩하므로
 *   이중 인코딩(Encoding 키를 또 encode하는 문제)이 발생하지 않는다.
 * 주의: 이 함수는 서비스키의 실제 값을 절대 로그로 출력하지 않는다.
 */
function normalizeServiceKey(raw) {
  if (!raw) return raw;
  let key = raw.trim();
  const looksPercentEncoded = /%[0-9A-Fa-f]{2}/.test(key);
  if (looksPercentEncoded) {
    try {
      key = decodeURIComponent(key);
    } catch (e) {
      // 잘못된 percent-encoding이면 decode하지 않고 원본 유지
    }
  }
  return key;
}

const RAW_KEY = process.env.RDA_SERVICE_KEY || '';
const NORMALIZED_KEY = normalizeServiceKey(RAW_KEY);

// RDA/공공데이터포털의 오류 응답(XML)을 파싱해서 사람이 읽을 수 있는 메시지로 변환한다.
async function parseRdaErrorXml(xmlText) {
  try {
    const parsed = await xml2js.parseStringPromise(xmlText, {
      explicitArray: false,
      mergeAttrs: true,
      trim: true,
    });
    const header = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (header) {
      return {
        errMsg: header.errMsg || null,
        returnAuthMsg: header.returnAuthMsg || null,
        returnReasonCode: header.returnReasonCode || null,
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// RDA API를 호출하고 XML 응답을 JSON으로 변환하는 공통 함수
// 참고: 성공 응답(HTTP 200) 파싱은 explicitArray:true를 사용한다.
// 이는 별도 검증 프로젝트(cashmeal-app-v3)에서 실제 RDA API 응답을 직접 호출해
// 확인한 구조(response.header[0].result_Code, response.body[0].items[0].item[...])를 기준으로 한 것이다.
async function callRdaApi(endpoint, params) {
  if (!hasKey()) {
    const err = new Error('RDA_SERVICE_KEY가 .env 파일에 설정되어 있지 않습니다. README.md를 참고해 키를 입력해주세요.');
    err.code = 'NO_KEY';
    throw err;
  }
  try {
    const res = await axios.get(endpoint, {
      params: { serviceKey: NORMALIZED_KEY, ...params },
      responseType: 'text',
      timeout: 8000,
    });
    const parsed = await xml2js.parseStringPromise(res.data, {
      explicitArray: true,
      trim: true,
    });
    return parsed;
  } catch (e) {
    // 디버그: axios가 실제로 보낸 요청 URL을 재구성해서 serviceKey만 가리고 출력한다.
    if (e.config) {
      const debugParams = { ...(e.config.params || {}) };
      if (debugParams.serviceKey) debugParams.serviceKey = '[REDACTED]';
      const debugUrl = `${e.config.url}?${new URLSearchParams(debugParams).toString()}`;
      console.error('[실제 요청 URL(서비스키 가림)]', debugUrl);
    }
    // 디버그: RDA가 400 등 오류 시 실제로 돌려준 응답 본문 원문(서비스키는 포함되지 않음)을 그대로 출력한다.
    console.error('[RDA 응답 본문 원문]', e.response ? e.response.data : '(응답 자체를 받지 못함: ' + e.message + ')');

    // axios가 4xx/5xx를 던진 경우: 응답 본문(XML)에 RDA의 실제 오류 메시지가 들어있으므로 파싱해서 보여준다.
    if (e.response && e.response.data) {
      const rdaError = await parseRdaErrorXml(e.response.data);
      console.error(
        `[RDA 오류 응답] status=${e.response.status}`,
        rdaError
          ? `errMsg=${rdaError.errMsg} / returnAuthMsg=${rdaError.returnAuthMsg} / returnReasonCode=${rdaError.returnReasonCode}`
          : '(XML 파싱 실패, 원문 일부: ' + String(e.response.data).slice(0, 200) + ')'
      );
      const err = new Error(
        rdaError
          ? `RDA API 오류: ${rdaError.errMsg || ''} ${rdaError.returnAuthMsg || ''} (returnReasonCode=${rdaError.returnReasonCode || '없음'})`.trim()
          : `RDA API가 HTTP ${e.response.status}를 반환했습니다.`
      );
      err.code = 'RDA_HTTP_ERROR';
      err.httpStatus = e.response.status;
      err.rdaError = rdaError;
      throw err;
    }
    // 네트워크 오류 등 응답 자체가 없는 경우
    console.error('[RDA 호출 실패]', e.message);
    throw e;
  }
}

// 배열/단일값을 항상 단일값으로 통일 (xml2js explicitArray:true는 항상 배열로 감싸므로)
function one(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

// API①/API② 공통: response.header[0]에서 resultCode/resultMsg를 꺼낸다.
// (참고: 이 result_Code/result_Msg 스키마는 별도 검증 프로젝트에서 실제 200 응답으로 확인한 구조다.
//  cmmMsgHeader/errMsg 스키마는 서비스키 미등록 등 HTTP 4xx 오류에서 별도로 내려오는 다른 스키마이며,
//  그 경우는 parseRdaErrorXml에서 처리한다.)
function getResponseHeader(parsed) {
  const header = parsed?.response?.header?.[0];
  if (!header) return { resultCode: null, resultMsg: null };
  return { resultCode: one(header.result_Code) ?? null, resultMsg: one(header.result_Msg) ?? null };
}

// API① 응답에서 음식 후보 목록을 꺼낸다.
function parseApi1Items(parsed) {
  const body = parsed?.response?.body?.[0];
  const items = body?.items?.[0]?.item || [];
  return items.map((x) => ({
    food_Code: one(x.food_Code),
    food_Name: one(x.food_Name),
    large_Name: one(x.large_Name),
    middle_Name: one(x.middle_Name),
    food_Volume: one(x.food_Volume),
  }));
}

// API② 응답에서 메인 음식 정보와 재료(idnt_List) 목록을 꺼낸다.
// 실제 구조: response.body[0].items[0].item[0] = 메인 음식 1건
//            그 안의 idnt_List[0].idnt (또는 .item) = 재료별 데이터 배열
function parseApi2Ingredients(parsed) {
  const body = parsed?.response?.body?.[0];
  const mainItem = body?.items?.[0]?.item?.[0];
  if (!mainItem) return { mainFoodCode: null, mainFoodName: null, ingredients: [] };

  const rawList = mainItem.idnt_List?.[0]?.idnt || mainItem.idnt_List?.[0]?.item || mainItem.idnt_List || [];
  const list = (Array.isArray(rawList) ? rawList : [rawList]).filter(Boolean);

  return {
    mainFoodCode: one(mainItem.main_Food_Code) ?? null,
    mainFoodName: one(mainItem.main_Food_Name) ?? null,
    ingredients: list.map((x) => ({
      food_Name: one(x.food_Name),
      food_Weight: one(x.food_Weight),
      energy_Qy: one(x.energy_Qy),
      water_Qy: one(x.water_Qy),
      prot_Qy: one(x.prot_Qy),
      ntrfs_Qy: one(x.ntrfs_Qy),
      ashs_Qy: one(x.ashs_Qy),
      carbohydrate_Qy: one(x.carbohydrate_Qy),
      sugar_Qy: one(x.sugar_Qy),
      fibtg_Qy: one(x.fibtg_Qy),
      na_Qy: one(x.na_Qy),
      clci_Qy: one(x.clci_Qy),
      phph_Qy: one(x.phph_Qy),
      ptss_Qy: one(x.ptss_Qy),
    })),
  };
}

// ---------- 테스트용 헬스체크 ----------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    keyConfigured: hasKey(),
    message: hasKey()
      ? '서비스키가 설정되어 있습니다. /api/foods?name=사과 로 실제 연동을 테스트해보세요.'
      : '.env 파일의 RDA_SERVICE_KEY가 아직 비어 있습니다.',
  });
});

// ---------- API ① 음식 검색 ----------
// GET /api/foods?name=김치찌개
// food_Group_Code는 선택 파라미터이므로, 특정 식품군으로 좁히고 싶을 때만 ?groupCode=... 로 전달한다.
app.get('/api/foods', async (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'name 쿼리 파라미터가 필요합니다. 예: /api/foods?name=김치찌개' });
  }
  const params = {
    Page_No: 1,
    Page_Size: 10,
    food_Name: name,
  };
  if (req.query.groupCode) {
    params.food_Group_Code = req.query.groupCode;
  }
  try {
    const parsed = await callRdaApi(API1_ENDPOINT, params);
    const { resultCode, resultMsg } = getResponseHeader(parsed);
    const foods = parseApi1Items(parsed).filter((f) => f.food_Code);
    res.json({ source: 'rda_api', resultCode, resultMsg, count: foods.length, items: foods });
  } catch (e) {
    res.status(502).json({
      error: 'RDA 음식 검색 API 호출에 실패했습니다.',
      detail: e.message,
      code: e.code || null,
      rdaError: e.rdaError || null,
    });
  }
});

// ---------- API ② 음식 상세(재료·영양정보) ----------
// GET /api/foods/D065003
app.get('/api/foods/:code', async (req, res) => {
  const code = req.params.code;
  try {
    const parsed = await callRdaApi(API2_ENDPOINT, { food_Code: code });
    const { resultCode, resultMsg } = getResponseHeader(parsed);
    const { mainFoodCode, mainFoodName, ingredients } = parseApi2Ingredients(parsed);

    const mapped = ingredients.map((it) => ({
      ingredient_name: it.food_Name ?? null,
      food_weight: it.food_Weight !== undefined && it.food_Weight !== null ? parseFloat(it.food_Weight) : null,
      main_food_code: mainFoodCode,
      main_food_name: mainFoodName,
      nutrients: {
        energy: it.energy_Qy != null ? parseFloat(it.energy_Qy) : null,
        protein: it.prot_Qy != null ? parseFloat(it.prot_Qy) : null,
        fat: it.ntrfs_Qy != null ? parseFloat(it.ntrfs_Qy) : null,
        carbohydrate: it.carbohydrate_Qy != null ? parseFloat(it.carbohydrate_Qy) : null,
        sugar: it.sugar_Qy != null ? parseFloat(it.sugar_Qy) : null,
        fiber: it.fibtg_Qy != null ? parseFloat(it.fibtg_Qy) : null,
        sodium: it.na_Qy != null ? parseFloat(it.na_Qy) : null,
        calcium: it.clci_Qy != null ? parseFloat(it.clci_Qy) : null,
        phosphorus: it.phph_Qy != null ? parseFloat(it.phph_Qy) : null,
        potassium: it.ptss_Qy != null ? parseFloat(it.ptss_Qy) : null,
        water: it.water_Qy != null ? parseFloat(it.water_Qy) : null,
        ash: it.ashs_Qy != null ? parseFloat(it.ashs_Qy) : null,
      },
      raw: it,
    }));
    res.json({
      source: 'rda_api', food_Code: code, resultCode, resultMsg,
      main_food_code: mainFoodCode, main_food_name: mainFoodName,
      count: mapped.length, items: mapped,
    });
  } catch (e) {
    res.status(502).json({
      error: 'RDA 상세정보 API 호출에 실패했습니다.',
      detail: e.message,
      code: e.code || null,
      rdaError: e.rdaError || null,
    });
  }
});

app.listen(PORT, () => {
  console.log(`캐시밀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(hasKey() ? '✅ RDA_SERVICE_KEY 설정됨' : '⚠️  RDA_SERVICE_KEY가 비어있습니다. .env를 확인하세요.');
});
