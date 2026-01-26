// Data Validation Service
// CRF 데이터 검증 서비스

import type { FieldDefinition, ValidationRule, ValidationStatus } from '../types';

export interface ValidationResult {
  status: ValidationStatus;
  message: string | null;
  field_code: string;
}

export interface FormValidationResult {
  isValid: boolean;
  hasWarnings: boolean;
  results: ValidationResult[];
}

/**
 * 단일 필드 검증
 */
export function validateField(
  fieldDef: FieldDefinition,
  value: string | null | undefined,
  allFieldValues?: Record<string, string | null>
): ValidationResult {
  const fieldCode = fieldDef.field_code;
  
  // NULL 또는 빈 값 처리
  if (value === null || value === undefined || value === '') {
    if (fieldDef.is_required) {
      return {
        status: 'ERROR',
        message: `${fieldDef.field_name}은(는) 필수 입력 항목입니다.`,
        field_code: fieldCode,
      };
    }
    return { status: 'VALID', message: null, field_code: fieldCode };
  }

  // 검증 규칙 파싱
  let rules: ValidationRule | null = null;
  if (fieldDef.validation_rules) {
    try {
      rules = JSON.parse(fieldDef.validation_rules);
    } catch {
      // JSON 파싱 실패 시 무시
    }
  }

  // 필드 타입별 검증
  switch (fieldDef.field_type) {
    case 'NUMBER':
      return validateNumber(fieldDef, value, rules);
    
    case 'DATE':
      return validateDate(fieldDef, value, rules, allFieldValues);
    
    case 'DATETIME':
      return validateDateTime(fieldDef, value, rules);
    
    case 'TEXT':
    case 'TEXTAREA':
      return validateText(fieldDef, value, rules);
    
    case 'SELECT':
    case 'RADIO':
      return validateSelect(fieldDef, value);
    
    case 'MULTI_SELECT':
    case 'CHECKBOX':
      return validateMultiSelect(fieldDef, value);
    
    default:
      return { status: 'VALID', message: null, field_code: fieldCode };
  }
}

/**
 * 숫자 필드 검증
 */
function validateNumber(
  fieldDef: FieldDefinition,
  value: string,
  rules: ValidationRule | null
): ValidationResult {
  const fieldCode = fieldDef.field_code;
  const numValue = parseFloat(value);

  if (isNaN(numValue)) {
    return {
      status: 'ERROR',
      message: `${fieldDef.field_name}은(는) 유효한 숫자여야 합니다.`,
      field_code: fieldCode,
    };
  }

  // 범위 검증
  const min = fieldDef.min_value ? parseFloat(fieldDef.min_value) : null;
  const max = fieldDef.max_value ? parseFloat(fieldDef.max_value) : null;

  if (min !== null && numValue < min) {
    return {
      status: 'ERROR',
      message: `${fieldDef.field_name}은(는) ${min} 이상이어야 합니다.`,
      field_code: fieldCode,
    };
  }

  if (max !== null && numValue > max) {
    return {
      status: 'ERROR',
      message: `${fieldDef.field_name}은(는) ${max} 이하여야 합니다.`,
      field_code: fieldCode,
    };
  }

  // 경고 범위 검증
  if (rules) {
    if (rules.warnMin !== undefined && numValue < rules.warnMin) {
      return {
        status: 'WARNING',
        message: `${fieldDef.field_name}이(가) 일반적인 범위(${rules.warnMin} 이상)보다 낮습니다.`,
        field_code: fieldCode,
      };
    }

    if (rules.warnMax !== undefined && numValue > rules.warnMax) {
      return {
        status: 'WARNING',
        message: `${fieldDef.field_name}이(가) 일반적인 범위(${rules.warnMax} 이하)보다 높습니다.`,
        field_code: fieldCode,
      };
    }
  }

  return { status: 'VALID', message: null, field_code: fieldCode };
}

/**
 * 날짜 필드 검증
 */
function validateDate(
  fieldDef: FieldDefinition,
  value: string,
  rules: ValidationRule | null,
  allFieldValues?: Record<string, string | null>
): ValidationResult {
  const fieldCode = fieldDef.field_code;
  const dateValue = new Date(value);

  if (isNaN(dateValue.getTime())) {
    return {
      status: 'ERROR',
      message: `${fieldDef.field_name}은(는) 유효한 날짜 형식이어야 합니다.`,
      field_code: fieldCode,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (rules) {
    // maxDate 검증
    if (rules.maxDate === 'today' && dateValue > today) {
      return {
        status: 'ERROR',
        message: `${fieldDef.field_name}은(는) 오늘 이전이어야 합니다.`,
        field_code: fieldCode,
      };
    }

    // 나이 제한 검증 (예: maxDate: "today-18y")
    if (rules.maxDate && rules.maxDate.includes('y')) {
      const match = rules.maxDate.match(/today-(\d+)y/);
      if (match) {
        const years = parseInt(match[1]);
        const maxDate = new Date(today);
        maxDate.setFullYear(maxDate.getFullYear() - years);
        if (dateValue > maxDate) {
          return {
            status: 'ERROR',
            message: `${fieldDef.field_name} 기준 나이가 ${years}세 미만입니다.`,
            field_code: fieldCode,
          };
        }
      }
    }

    // 다른 필드와 비교
    if (rules.minField && allFieldValues) {
      const minFieldValue = allFieldValues[rules.minField];
      if (minFieldValue) {
        const minDate = new Date(minFieldValue);
        if (dateValue < minDate) {
          return {
            status: 'ERROR',
            message: `${fieldDef.field_name}은(는) 시작일 이후여야 합니다.`,
            field_code: fieldCode,
          };
        }
      }
    }
  }

  return { status: 'VALID', message: null, field_code: fieldCode };
}

/**
 * 날짜시간 필드 검증
 */
function validateDateTime(
  fieldDef: FieldDefinition,
  value: string,
  rules: ValidationRule | null
): ValidationResult {
  const fieldCode = fieldDef.field_code;
  const dateValue = new Date(value);

  if (isNaN(dateValue.getTime())) {
    return {
      status: 'ERROR',
      message: `${fieldDef.field_name}은(는) 유효한 날짜/시간 형식이어야 합니다.`,
      field_code: fieldCode,
    };
  }

  return { status: 'VALID', message: null, field_code: fieldCode };
}

/**
 * 텍스트 필드 검증
 */
function validateText(
  fieldDef: FieldDefinition,
  value: string,
  rules: ValidationRule | null
): ValidationResult {
  const fieldCode = fieldDef.field_code;

  if (rules) {
    if (rules.minLength !== undefined && value.length < rules.minLength) {
      return {
        status: 'ERROR',
        message: `${fieldDef.field_name}은(는) 최소 ${rules.minLength}자 이상이어야 합니다.`,
        field_code: fieldCode,
      };
    }

    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      return {
        status: 'ERROR',
        message: `${fieldDef.field_name}은(는) 최대 ${rules.maxLength}자 이하여야 합니다.`,
        field_code: fieldCode,
      };
    }

    if (rules.pattern) {
      const regex = new RegExp(rules.pattern);
      if (!regex.test(value)) {
        return {
          status: 'ERROR',
          message: `${fieldDef.field_name}은(는) 올바른 형식이 아닙니다.`,
          field_code: fieldCode,
        };
      }
    }
  }

  return { status: 'VALID', message: null, field_code: fieldCode };
}

/**
 * 선택 필드 검증
 */
function validateSelect(
  fieldDef: FieldDefinition,
  value: string
): ValidationResult {
  const fieldCode = fieldDef.field_code;

  if (fieldDef.options) {
    try {
      const options = JSON.parse(fieldDef.options);
      const validValues = options.map((o: { value: string }) => o.value);
      
      if (!validValues.includes(value)) {
        return {
          status: 'ERROR',
          message: `${fieldDef.field_name}에 유효하지 않은 값이 선택되었습니다.`,
          field_code: fieldCode,
        };
      }
    } catch {
      // JSON 파싱 실패 시 무시
    }
  }

  return { status: 'VALID', message: null, field_code: fieldCode };
}

/**
 * 다중 선택 필드 검증
 */
function validateMultiSelect(
  fieldDef: FieldDefinition,
  value: string
): ValidationResult {
  const fieldCode = fieldDef.field_code;

  if (fieldDef.options) {
    try {
      const options = JSON.parse(fieldDef.options);
      const validValues = options.map((o: { value: string }) => o.value);
      const selectedValues = value.split(',').map(v => v.trim());
      
      for (const selected of selectedValues) {
        if (!validValues.includes(selected)) {
          return {
            status: 'ERROR',
            message: `${fieldDef.field_name}에 유효하지 않은 값이 포함되어 있습니다.`,
            field_code: fieldCode,
          };
        }
      }
    } catch {
      // JSON 파싱 실패 시 무시
    }
  }

  return { status: 'VALID', message: null, field_code: fieldCode };
}

/**
 * 폼 전체 검증
 */
export function validateForm(
  fieldDefinitions: FieldDefinition[],
  formData: Record<string, string | null>
): FormValidationResult {
  const results: ValidationResult[] = [];
  let hasErrors = false;
  let hasWarnings = false;

  for (const fieldDef of fieldDefinitions) {
    const value = formData[fieldDef.field_code];
    const result = validateField(fieldDef, value, formData);
    results.push(result);

    if (result.status === 'ERROR') {
      hasErrors = true;
    } else if (result.status === 'WARNING') {
      hasWarnings = true;
    }
  }

  return {
    isValid: !hasErrors,
    hasWarnings,
    results,
  };
}

/**
 * Cross-field 검증 (활력징후 예시)
 */
export function validateVitalSigns(
  systolicBP: number | null,
  diastolicBP: number | null
): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (systolicBP !== null && diastolicBP !== null) {
    if (systolicBP <= diastolicBP) {
      results.push({
        status: 'ERROR',
        message: '수축기 혈압은 이완기 혈압보다 높아야 합니다.',
        field_code: 'SYSBP',
      });
    }

    // 맥압 검증 (정상 범위: 30-60 mmHg)
    const pulsePressure = systolicBP - diastolicBP;
    if (pulsePressure < 30 || pulsePressure > 60) {
      results.push({
        status: 'WARNING',
        message: `맥압(${pulsePressure} mmHg)이 일반적인 범위(30-60 mmHg)를 벗어났습니다.`,
        field_code: 'SYSBP',
      });
    }
  }

  return results;
}

/**
 * BMI 계산
 */
export function calculateBMI(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return parseFloat((weightKg / (heightM * heightM)).toFixed(1));
}

/**
 * 나이 계산
 */
export function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
}
