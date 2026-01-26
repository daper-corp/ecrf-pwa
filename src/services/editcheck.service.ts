// Edit Check Engine Service
// 고급 데이터 검증 규칙 엔진
// Cross-Visit, Cross-Field, 의학적 논리 검증

import type { D1Database } from '@cloudflare/workers-types';

// =====================================================
// TYPES
// =====================================================

export type RuleSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type RuleType = 
  | 'REQUIRED'           // 필수 필드
  | 'RANGE'              // 범위 검증
  | 'DATE_LOGIC'         // 날짜 논리
  | 'CROSS_FIELD'        // 필드 간 검증
  | 'CROSS_VISIT'        // 방문 간 검증
  | 'CONDITIONAL'        // 조건부 검증
  | 'MEDICAL_LOGIC'      // 의학적 논리
  | 'CONSISTENCY';       // 일관성 검증

export interface EditCheckRule {
  id: string;
  name: string;
  description: string;
  type: RuleType;
  severity: RuleSeverity;
  formCode?: string;
  fieldCode?: string;
  condition: string;       // JavaScript 표현식
  message: string;
  isActive: boolean;
}

export interface EditCheckContext {
  studyId: string;
  siteId: string;
  subjectId: string;
  visitId: string;
  formCode: string;
  currentData: Record<string, any>;
  allVisitData?: Record<string, Record<string, any>>;  // visitId -> formCode -> data
  subjectInfo?: Record<string, any>;
}

export interface EditCheckResult {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  fieldCode?: string;
  passed: boolean;
  message: string;
  details?: string;
}

// =====================================================
// BUILT-IN EDIT CHECK RULES
// =====================================================

const BUILT_IN_RULES: EditCheckRule[] = [
  // ===== 범위 검증 =====
  {
    id: 'EC001',
    name: 'Systolic BP Range',
    description: '수축기 혈압 범위 검증',
    type: 'RANGE',
    severity: 'ERROR',
    formCode: 'VS',
    fieldCode: 'systolic_bp',
    condition: 'value >= 80 && value <= 200',
    message: '수축기 혈압은 80-200 mmHg 범위여야 합니다.',
    isActive: true,
  },
  {
    id: 'EC002',
    name: 'Diastolic BP Range',
    description: '이완기 혈압 범위 검증',
    type: 'RANGE',
    severity: 'ERROR',
    formCode: 'VS',
    fieldCode: 'diastolic_bp',
    condition: 'value >= 40 && value <= 120',
    message: '이완기 혈압은 40-120 mmHg 범위여야 합니다.',
    isActive: true,
  },
  {
    id: 'EC003',
    name: 'Heart Rate Range',
    description: '맥박 범위 검증',
    type: 'RANGE',
    severity: 'ERROR',
    formCode: 'VS',
    fieldCode: 'heart_rate',
    condition: 'value >= 40 && value <= 200',
    message: '맥박은 40-200 bpm 범위여야 합니다.',
    isActive: true,
  },
  {
    id: 'EC004',
    name: 'Body Temperature Range',
    description: '체온 범위 검증',
    type: 'RANGE',
    severity: 'ERROR',
    formCode: 'VS',
    fieldCode: 'body_temp',
    condition: 'value >= 35.0 && value <= 42.0',
    message: '체온은 35.0-42.0°C 범위여야 합니다.',
    isActive: true,
  },
  {
    id: 'EC005',
    name: 'Weight Range',
    description: '체중 범위 검증',
    type: 'RANGE',
    severity: 'ERROR',
    formCode: 'DM',
    fieldCode: 'weight',
    condition: 'value >= 30 && value <= 300',
    message: '체중은 30-300 kg 범위여야 합니다.',
    isActive: true,
  },
  {
    id: 'EC006',
    name: 'Height Range',
    description: '신장 범위 검증',
    type: 'RANGE',
    severity: 'ERROR',
    formCode: 'DM',
    fieldCode: 'height',
    condition: 'value >= 100 && value <= 250',
    message: '신장은 100-250 cm 범위여야 합니다.',
    isActive: true,
  },

  // ===== Cross-Field 검증 =====
  {
    id: 'EC010',
    name: 'BP Logic Check',
    description: '수축기 > 이완기 혈압 검증',
    type: 'CROSS_FIELD',
    severity: 'ERROR',
    formCode: 'VS',
    condition: 'data.systolic_bp > data.diastolic_bp',
    message: '수축기 혈압이 이완기 혈압보다 높아야 합니다.',
    isActive: true,
  },
  {
    id: 'EC011',
    name: 'BMI Calculation Check',
    description: 'BMI 자동 계산 검증',
    type: 'CROSS_FIELD',
    severity: 'WARNING',
    formCode: 'DM',
    condition: `
      const weight = parseFloat(data.weight);
      const height = parseFloat(data.height);
      if (weight && height) {
        const calculatedBMI = (weight / ((height/100) * (height/100))).toFixed(1);
        const recordedBMI = parseFloat(data.bmi);
        return !recordedBMI || Math.abs(calculatedBMI - recordedBMI) < 0.5;
      }
      return true;
    `,
    message: 'BMI 값이 체중/신장 기준 계산값과 다릅니다.',
    isActive: true,
  },
  {
    id: 'EC012',
    name: 'AE End Date Logic',
    description: '이상반응 종료일 검증',
    type: 'CROSS_FIELD',
    severity: 'ERROR',
    formCode: 'AE',
    condition: `
      if (data.ae_end_date && data.ae_start_date) {
        return new Date(data.ae_end_date) >= new Date(data.ae_start_date);
      }
      return true;
    `,
    message: '이상반응 종료일은 시작일 이후여야 합니다.',
    isActive: true,
  },
  {
    id: 'EC013',
    name: 'AE Ongoing vs End Date',
    description: '진행 중인 이상반응은 종료일이 없어야 함',
    type: 'CROSS_FIELD',
    severity: 'ERROR',
    formCode: 'AE',
    condition: `
      if (data.ae_ongoing === 'Y' && data.ae_end_date) {
        return false;
      }
      if (data.ae_ongoing === 'N' && !data.ae_end_date) {
        return false;
      }
      return true;
    `,
    message: '진행 중인 이상반응은 종료일이 없어야 하고, 종료된 이상반응은 종료일이 있어야 합니다.',
    isActive: true,
  },

  // ===== 날짜 논리 검증 =====
  {
    id: 'EC020',
    name: 'Assessment Date Not Future',
    description: '평가일이 미래 날짜가 아닌지 검증',
    type: 'DATE_LOGIC',
    severity: 'ERROR',
    fieldCode: 'measurement_date',
    condition: `
      const date = new Date(value);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return date <= today;
    `,
    message: '측정일은 오늘 이후일 수 없습니다.',
    isActive: true,
  },
  {
    id: 'EC021',
    name: 'Birth Date Age Check',
    description: '생년월일 기준 연령 검증 (18세 이상)',
    type: 'DATE_LOGIC',
    severity: 'ERROR',
    formCode: 'DM',
    fieldCode: 'birth_date',
    condition: `
      const birthDate = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate()) 
        ? age - 1 : age;
      return actualAge >= 18;
    `,
    message: '피험자는 18세 이상이어야 합니다.',
    isActive: true,
  },

  // ===== Cross-Visit 검증 =====
  {
    id: 'EC030',
    name: 'Weight Change Check',
    description: '방문 간 체중 변화 검증 (10% 이상 변화 시 경고)',
    type: 'CROSS_VISIT',
    severity: 'WARNING',
    formCode: 'VS',
    fieldCode: 'weight',
    condition: `
      const currentWeight = parseFloat(data.weight);
      if (!currentWeight || !previousVisitData?.VS?.weight) return true;
      const prevWeight = parseFloat(previousVisitData.VS.weight);
      const changePercent = Math.abs((currentWeight - prevWeight) / prevWeight * 100);
      return changePercent < 10;
    `,
    message: '이전 방문 대비 체중 변화가 10% 이상입니다. 확인이 필요합니다.',
    isActive: true,
  },
  {
    id: 'EC031',
    name: 'BP Significant Change',
    description: '방문 간 혈압 급격한 변화 검증',
    type: 'CROSS_VISIT',
    severity: 'WARNING',
    formCode: 'VS',
    condition: `
      const currentSys = parseFloat(data.systolic_bp);
      const currentDia = parseFloat(data.diastolic_bp);
      if (!currentSys || !currentDia) return true;
      if (!previousVisitData?.VS?.systolic_bp) return true;
      
      const prevSys = parseFloat(previousVisitData.VS.systolic_bp);
      const prevDia = parseFloat(previousVisitData.VS.diastolic_bp);
      
      const sysChange = Math.abs(currentSys - prevSys);
      const diaChange = Math.abs(currentDia - prevDia);
      
      return sysChange < 30 && diaChange < 20;
    `,
    message: '이전 방문 대비 혈압이 급격히 변화했습니다 (수축기 30mmHg 또는 이완기 20mmHg 이상).',
    isActive: true,
  },
  {
    id: 'EC032',
    name: 'Visit Date Order',
    description: '방문일 순서 검증',
    type: 'CROSS_VISIT',
    severity: 'ERROR',
    condition: `
      if (!previousVisitData?._visitDate || !data._visitDate) return true;
      return new Date(data._visitDate) >= new Date(previousVisitData._visitDate);
    `,
    message: '현재 방문일이 이전 방문일보다 빠를 수 없습니다.',
    isActive: true,
  },

  // ===== 의학적 논리 검증 =====
  {
    id: 'EC040',
    name: 'Severe AE Requires SAE',
    description: '심각한 이상반응은 SAE 여부 확인 필요',
    type: 'MEDICAL_LOGIC',
    severity: 'WARNING',
    formCode: 'AE',
    condition: `
      if (data.ae_severity === 'SEVERE' && data.ae_serious !== 'Y') {
        return false;
      }
      return true;
    `,
    message: '심각한(Severe) 이상반응의 경우 중대한 이상반응(SAE) 여부를 확인하세요.',
    isActive: true,
  },
  {
    id: 'EC041',
    name: 'High BP Warning',
    description: '고혈압 경고',
    type: 'MEDICAL_LOGIC',
    severity: 'WARNING',
    formCode: 'VS',
    condition: `
      const sys = parseFloat(data.systolic_bp);
      const dia = parseFloat(data.diastolic_bp);
      return !(sys >= 180 || dia >= 110);
    `,
    message: '고혈압 위기 수준입니다 (수축기 ≥180 또는 이완기 ≥110). 의료진 확인이 필요합니다.',
    isActive: true,
  },
  {
    id: 'EC042',
    name: 'Low BP Warning',
    description: '저혈압 경고',
    type: 'MEDICAL_LOGIC',
    severity: 'WARNING',
    formCode: 'VS',
    condition: `
      const sys = parseFloat(data.systolic_bp);
      const dia = parseFloat(data.diastolic_bp);
      return !(sys < 90 || dia < 60);
    `,
    message: '저혈압 상태입니다 (수축기 <90 또는 이완기 <60). 의료진 확인이 필요합니다.',
    isActive: true,
  },
  {
    id: 'EC043',
    name: 'Fever Detection',
    description: '발열 감지',
    type: 'MEDICAL_LOGIC',
    severity: 'WARNING',
    formCode: 'VS',
    fieldCode: 'body_temp',
    condition: 'parseFloat(value) < 38.0',
    message: '발열이 감지되었습니다 (체온 ≥38.0°C). 이상반응 기록이 필요할 수 있습니다.',
    isActive: true,
  },
  {
    id: 'EC044',
    name: 'Tachycardia Warning',
    description: '빈맥 경고',
    type: 'MEDICAL_LOGIC',
    severity: 'WARNING',
    formCode: 'VS',
    fieldCode: 'heart_rate',
    condition: 'parseFloat(value) < 100',
    message: '빈맥이 감지되었습니다 (맥박 ≥100 bpm).',
    isActive: true,
  },
  {
    id: 'EC045',
    name: 'Bradycardia Warning',
    description: '서맥 경고',
    type: 'MEDICAL_LOGIC',
    severity: 'WARNING',
    formCode: 'VS',
    fieldCode: 'heart_rate',
    condition: 'parseFloat(value) > 50',
    message: '서맥이 감지되었습니다 (맥박 <50 bpm).',
    isActive: true,
  },

  // ===== 조건부 검증 =====
  {
    id: 'EC050',
    name: 'Female Pregnancy Check',
    description: '여성 피험자 임신 여부 확인',
    type: 'CONDITIONAL',
    severity: 'ERROR',
    formCode: 'DM',
    condition: `
      if (data.gender === 'F' && !data.pregnancy_status) {
        return false;
      }
      return true;
    `,
    message: '여성 피험자의 경우 임신 여부를 반드시 확인해야 합니다.',
    isActive: true,
  },
  {
    id: 'EC051',
    name: 'Consent Date Required',
    description: '동의 획득 시 동의일 필수',
    type: 'CONDITIONAL',
    severity: 'ERROR',
    formCode: 'IC',
    condition: `
      if (data.consent_obtained === 'Y' && !data.consent_date) {
        return false;
      }
      return true;
    `,
    message: '동의를 획득한 경우 동의일을 입력해야 합니다.',
    isActive: true,
  },

  // ===== 일관성 검증 =====
  {
    id: 'EC060',
    name: 'Demographics Consistency',
    description: '인구통계 정보 일관성 (성별은 변경 불가)',
    type: 'CONSISTENCY',
    severity: 'ERROR',
    formCode: 'DM',
    fieldCode: 'gender',
    condition: `
      if (!previousValue) return true;
      return value === previousValue;
    `,
    message: '성별 정보는 이전 입력값과 일치해야 합니다.',
    isActive: true,
  },
  {
    id: 'EC061',
    name: 'Birth Date Consistency',
    description: '생년월일 일관성 (변경 불가)',
    type: 'CONSISTENCY',
    severity: 'ERROR',
    formCode: 'DM',
    fieldCode: 'birth_date',
    condition: `
      if (!previousValue) return true;
      return value === previousValue;
    `,
    message: '생년월일은 이전 입력값과 일치해야 합니다.',
    isActive: true,
  },
];

// =====================================================
// EDIT CHECK ENGINE
// =====================================================

export class EditCheckEngine {
  private rules: EditCheckRule[];
  private db: D1Database;

  constructor(db: D1Database, customRules: EditCheckRule[] = [], useBuiltInRules: boolean = false) {
    this.db = db;
    // By default, only use custom rules from DB
    // Set useBuiltInRules to true to include built-in rules (requires matching field names)
    this.rules = useBuiltInRules ? [...BUILT_IN_RULES, ...customRules] : customRules;
  }

  /**
   * 단일 필드 검증
   */
  async validateField(
    context: EditCheckContext,
    fieldCode: string,
    value: any,
    previousValue?: any
  ): Promise<EditCheckResult[]> {
    const results: EditCheckResult[] = [];
    const applicableRules = this.rules.filter(rule => 
      rule.isActive &&
      (!rule.formCode || rule.formCode === context.formCode) &&
      (!rule.fieldCode || rule.fieldCode === fieldCode) &&
      ['REQUIRED', 'RANGE', 'DATE_LOGIC', 'CONSISTENCY'].includes(rule.type)
    );

    for (const rule of applicableRules) {
      try {
        const passed = this.evaluateCondition(rule.condition, {
          value,
          previousValue,
          data: context.currentData,
          fieldCode,
        });

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          fieldCode,
          passed,
          message: passed ? '' : rule.message,
        });
      } catch (error) {
        console.error(`Edit check rule ${rule.id} failed:`, error);
      }
    }

    return results;
  }

  /**
   * 폼 레벨 검증 (Cross-Field)
   */
  async validateForm(context: EditCheckContext): Promise<EditCheckResult[]> {
    const results: EditCheckResult[] = [];
    const applicableRules = this.rules.filter(rule =>
      rule.isActive &&
      (!rule.formCode || rule.formCode === context.formCode) &&
      ['CROSS_FIELD', 'CONDITIONAL', 'MEDICAL_LOGIC'].includes(rule.type)
    );

    for (const rule of applicableRules) {
      try {
        const passed = this.evaluateCondition(rule.condition, {
          data: context.currentData,
          subjectInfo: context.subjectInfo,
        });

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          fieldCode: rule.fieldCode,
          passed,
          message: passed ? '' : rule.message,
        });
      } catch (error) {
        console.error(`Edit check rule ${rule.id} failed:`, error);
      }
    }

    return results;
  }

  /**
   * Visit 레벨 검증 (Cross-Visit)
   */
  async validateCrossVisit(context: EditCheckContext): Promise<EditCheckResult[]> {
    const results: EditCheckResult[] = [];

    // 이전 방문 데이터 로드
    const previousVisitData = await this.loadPreviousVisitData(context);
    
    const applicableRules = this.rules.filter(rule =>
      rule.isActive &&
      (!rule.formCode || rule.formCode === context.formCode) &&
      rule.type === 'CROSS_VISIT'
    );

    for (const rule of applicableRules) {
      try {
        const passed = this.evaluateCondition(rule.condition, {
          data: context.currentData,
          previousVisitData,
          allVisitData: context.allVisitData,
        });

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          fieldCode: rule.fieldCode,
          passed,
          message: passed ? '' : rule.message,
        });
      } catch (error) {
        console.error(`Edit check rule ${rule.id} failed:`, error);
      }
    }

    return results;
  }

  /**
   * 전체 검증 실행
   */
  async runAllChecks(context: EditCheckContext): Promise<EditCheckResult[]> {
    const results: EditCheckResult[] = [];

    // 1. 필드별 검증
    for (const [fieldCode, value] of Object.entries(context.currentData)) {
      const fieldResults = await this.validateField(context, fieldCode, value);
      results.push(...fieldResults.filter(r => !r.passed));
    }

    // 2. 폼 레벨 검증
    const formResults = await this.validateForm(context);
    results.push(...formResults.filter(r => !r.passed));

    // 3. Cross-Visit 검증
    const visitResults = await this.validateCrossVisit(context);
    results.push(...visitResults.filter(r => !r.passed));

    return results;
  }

  /**
   * 조건 평가 (Cloudflare Workers 호환 - new Function() 사용하지 않음)
   * 간단한 조건만 지원: 범위 체크, 비교 연산
   */
  private evaluateCondition(condition: string, context: Record<string, any>): boolean {
    try {
      const { value, data } = context;
      
      // 빈 조건이나 'true'는 통과
      if (!condition || condition.trim() === '' || condition.trim() === 'true') {
        return true;
      }
      
      // parseFloat(data['field'] || 0) 패턴을 값으로 치환
      let processedCondition = condition;
      
      // parseFloat(data['field'] || defaultValue) 패턴 처리
      const parseFloatPattern = /parseFloat\(data\['([^']+)'\]\s*\|\|\s*(\d+)\)/g;
      processedCondition = processedCondition.replace(parseFloatPattern, (match, key, defaultVal) => {
        const val = data?.[key];
        const numVal = parseFloat(val);
        return isNaN(numVal) ? defaultVal : String(numVal);
      });
      
      // data['field'] 패턴 처리
      const dataAccessPattern = /data\['([^']+)'\]/g;
      processedCondition = processedCondition.replace(dataAccessPattern, (match, key) => {
        const val = data?.[key];
        if (val === undefined || val === null || val === '') {
          return 'null';
        }
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          return String(numVal);
        }
        return `"${val}"`;
      });
      
      // data.field 패턴 처리
      const dataDotPattern = /data\.(\w+)/g;
      processedCondition = processedCondition.replace(dataDotPattern, (match, key) => {
        const val = data?.[key];
        if (val === undefined || val === null || val === '') {
          return 'null';
        }
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          return String(numVal);
        }
        return `"${val}"`;
      });
      
      // value 변수 치환
      processedCondition = processedCondition.replace(/\bvalue\b/g, () => {
        if (value === undefined || value === null || value === '') {
          return 'null';
        }
        const numVal = parseFloat(value);
        if (!isNaN(numVal)) {
          return String(numVal);
        }
        return `"${value}"`;
      });
      
      // parseFloat 제거 (이미 숫자로 변환됨)
      processedCondition = processedCondition.replace(/parseFloat\(([^)]+)\)/g, '$1');
      
      // 안전한 평가
      return this.safeEvaluate(processedCondition);
    } catch (error) {
      console.error('Condition evaluation failed:', condition, error);
      return true; // 오류 시 통과로 처리
    }
  }
  
  /**
   * 안전한 조건 평가기 (괄호로 구분된 OR/AND 연산 지원)
   */
  private safeEvaluate(expr: string): boolean {
    expr = expr.trim();
    
    // 빈 조건이나 'true' 문자열은 통과
    if (!expr || expr === 'true') {
      return true;
    }
    if (expr === 'false') {
      return false;
    }
    
    // 최외곽 괄호 제거
    if (expr.startsWith('(') && expr.endsWith(')') && this.isMatchingParens(expr)) {
      return this.safeEvaluate(expr.slice(1, -1));
    }
    
    // 최상위 레벨에서 || 찾기 (괄호 안이 아닌)
    const orIndex = this.findTopLevelOperator(expr, '||');
    if (orIndex !== -1) {
      const left = expr.substring(0, orIndex).trim();
      const right = expr.substring(orIndex + 2).trim();
      return this.safeEvaluate(left) || this.safeEvaluate(right);
    }
    
    // 최상위 레벨에서 && 찾기
    const andIndex = this.findTopLevelOperator(expr, '&&');
    if (andIndex !== -1) {
      const left = expr.substring(0, andIndex).trim();
      const right = expr.substring(andIndex + 2).trim();
      return this.safeEvaluate(left) && this.safeEvaluate(right);
    }
    
    // 비교 연산자 평가
    return this.evaluateComparison(expr);
  }
  
  /**
   * 괄호가 매칭되는지 확인
   */
  private isMatchingParens(expr: string): boolean {
    let depth = 0;
    for (let i = 0; i < expr.length - 1; i++) {
      if (expr[i] === '(') depth++;
      if (expr[i] === ')') depth--;
      if (depth === 0) return false; // 중간에 depth가 0이면 매칭 안됨
    }
    return depth === 1 && expr[expr.length - 1] === ')';
  }
  
  /**
   * 최상위 레벨에서 연산자 위치 찾기 (괄호 내부 무시)
   */
  private findTopLevelOperator(expr: string, operator: string): number {
    let depth = 0;
    for (let i = 0; i < expr.length - operator.length + 1; i++) {
      if (expr[i] === '(') depth++;
      if (expr[i] === ')') depth--;
      if (depth === 0 && expr.substring(i, i + operator.length) === operator) {
        return i;
      }
    }
    return -1;
  }
  
  /**
   * 비교 표현식 평가
   */
  private evaluateComparison(expr: string): boolean {
    expr = expr.trim();
    
    // null/undefined 체크 패턴
    if (expr.includes('=== null') || expr.includes('== null') || 
        expr.includes('=== undefined') || expr.includes('== undefined')) {
      const varPart = expr.split(/===?\s*(null|undefined)/)[0].trim();
      const val = this.parseValue(varPart);
      return val === null || val === undefined;
    }
    if (expr.includes('!== null') || expr.includes('!= null') ||
        expr.includes('!== undefined') || expr.includes('!= undefined')) {
      const varPart = expr.split(/!==?\s*(null|undefined)/)[0].trim();
      const val = this.parseValue(varPart);
      return val !== null && val !== undefined;
    }
    
    // 빈 문자열 체크
    if (expr.includes("=== ''") || expr.includes('=== ""')) {
      const varPart = expr.split(/===?\s*['"]{2}/)[0].trim();
      const val = this.parseValue(varPart);
      return val === '';
    }
    if (expr.includes("!== ''") || expr.includes('!== ""')) {
      const varPart = expr.split(/!==?\s*['"]{2}/)[0].trim();
      const val = this.parseValue(varPart);
      return val !== '';
    }
    
    // 숫자 비교 연산자 (순서 중요: >= <= 먼저)
    const operators = ['>=', '<=', '!==', '===', '!=', '==', '>', '<'];
    for (const op of operators) {
      const opIndex = expr.indexOf(op);
      if (opIndex !== -1) {
        const leftStr = expr.substring(0, opIndex).trim();
        const rightStr = expr.substring(opIndex + op.length).trim();
        const left = this.parseValue(leftStr);
        const right = this.parseValue(rightStr);
        
        // null/NaN 처리 - null이면 검증 통과 (값이 없으면 검사하지 않음)
        if (left === null || right === null) return true;
        if (typeof left === 'number' && isNaN(left)) return true;
        if (typeof right === 'number' && isNaN(right)) return true;
        
        switch (op) {
          case '>=': return Number(left) >= Number(right);
          case '<=': return Number(left) <= Number(right);
          case '>': return Number(left) > Number(right);
          case '<': return Number(left) < Number(right);
          case '===': return left === right;
          case '!==': return left !== right;
          case '==': return left == right;
          case '!=': return left != right;
        }
      }
    }
    
    // 단순 값 (truthy 체크)
    const val = this.parseValue(expr);
    return !!val && val !== 'null' && val !== 'undefined';
  }
  
  /**
   * 문자열을 값으로 파싱
   */
  private parseValue(str: string): any {
    str = str.trim();
    
    if (str === 'null' || str === 'undefined') return null;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'NaN') return NaN;
    
    // 문자열 리터럴
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      return str.slice(1, -1);
    }
    
    // 숫자
    const num = Number(str);
    if (!isNaN(num)) return num;
    
    return str;
  }

  /**
   * 이전 방문 데이터 로드
   */
  private async loadPreviousVisitData(context: EditCheckContext): Promise<Record<string, any> | null> {
    try {
      // 현재 방문 번호 조회
      const currentVisit = await this.db.prepare(`
        SELECT visit_number FROM visits WHERE id = ?
      `).bind(context.visitId).first<{ visit_number: number }>();

      if (!currentVisit || currentVisit.visit_number <= 1) {
        return null;
      }

      // 이전 방문 조회
      const previousVisit = await this.db.prepare(`
        SELECT v.id, v.actual_date FROM visits v
        WHERE v.subject_id = ? AND v.visit_number = ?
      `).bind(context.subjectId, currentVisit.visit_number - 1).first<{ id: string; actual_date: string }>();

      if (!previousVisit) {
        return null;
      }

      // 이전 방문의 CRF 데이터 로드
      const crfData = await this.db.prepare(`
        SELECT ci.form_code, cd.field_code, cd.field_value
        FROM crf_instances ci
        JOIN crf_data cd ON ci.id = cd.crf_instance_id
        WHERE ci.visit_id = ?
      `).bind(previousVisit.id).all();

      const result: Record<string, any> = {
        _visitDate: previousVisit.actual_date,
      };

      for (const row of crfData.results as any[]) {
        if (!result[row.form_code]) {
          result[row.form_code] = {};
        }
        result[row.form_code][row.field_code] = row.field_value;
      }

      return result;
    } catch (error) {
      console.error('Failed to load previous visit data:', error);
      return null;
    }
  }

  /**
   * 특정 Study의 커스텀 규칙 로드
   */
  async loadStudyRules(studyId: string): Promise<void> {
    // TODO: DB에서 Study별 커스텀 규칙 로드
    // 현재는 기본 규칙만 사용
  }

  /**
   * 규칙 목록 조회
   */
  getRules(): EditCheckRule[] {
    return this.rules;
  }

  /**
   * 규칙 추가
   */
  addRule(rule: EditCheckRule): void {
    this.rules.push(rule);
  }

  /**
   * 규칙 비활성화
   */
  disableRule(ruleId: string): void {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.isActive = false;
    }
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Edit Check 결과 요약
 */
export function summarizeResults(results: EditCheckResult[]): {
  errors: EditCheckResult[];
  warnings: EditCheckResult[];
  infos: EditCheckResult[];
  hasErrors: boolean;
  hasWarnings: boolean;
} {
  const errors = results.filter(r => !r.passed && r.severity === 'ERROR');
  const warnings = results.filter(r => !r.passed && r.severity === 'WARNING');
  const infos = results.filter(r => !r.passed && r.severity === 'INFO');

  return {
    errors,
    warnings,
    infos,
    hasErrors: errors.length > 0,
    hasWarnings: warnings.length > 0,
  };
}

/**
 * Edit Check Engine 인스턴스 생성
 */
export function createEditCheckEngine(db: D1Database): EditCheckEngine {
  return new EditCheckEngine(db);
}
