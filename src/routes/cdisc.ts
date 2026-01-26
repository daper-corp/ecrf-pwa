// CDISC Export Routes
// ODM XML 및 SDTM 포맷 데이터 내보내기 API
// Created: 2026-01-26

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getAuthUser } from '../middleware/auth';
import { hasPermission } from '../middleware/rbac';
import { createAuditLog, type AuditContext } from '../services/audit.service';
import { now } from '../utils/date';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// =====================================================
// CDISC ODM XML GENERATOR
// =====================================================

/**
 * XML 특수문자 이스케이프
 */
function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * ISO 8601 날짜 형식으로 변환
 */
function toISODate(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toISOString();
  } catch {
    return dateStr;
  }
}

/**
 * ODM XML 헤더 생성
 */
function generateODMHeader(studyOID: string, creationDateTime: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.cdisc.org/ns/odm/v1.3 ODM1-3-2.xsd"
     ODMVersion="1.3.2"
     FileType="Snapshot"
     FileOID="${escapeXml(studyOID)}_${creationDateTime.replace(/[^0-9]/g, '')}"
     CreationDateTime="${creationDateTime}"
     Granularity="All"
     SourceSystem="eCRF-PWA"
     SourceSystemVersion="2.0.0">`;
}

/**
 * Study 메타데이터 생성
 */
function generateStudyMetadata(study: any, forms: any[], fields: any[]): string {
  // Form별 필드 그룹화
  const formFieldsMap: Record<string, any[]> = {};
  for (const field of fields) {
    if (!formFieldsMap[field.form_code]) {
      formFieldsMap[field.form_code] = [];
    }
    formFieldsMap[field.form_code].push(field);
  }

  let metadata = `
  <Study OID="${escapeXml(study.id)}">
    <GlobalVariables>
      <StudyName>${escapeXml(study.short_title || study.title)}</StudyName>
      <StudyDescription>${escapeXml(study.description || '')}</StudyDescription>
      <ProtocolName>${escapeXml(study.protocol_number)}</ProtocolName>
    </GlobalVariables>
    <BasicDefinitions>
      <MeasurementUnit OID="MU.YEARS" Name="Years">
        <Symbol><TranslatedText xml:lang="en">Years</TranslatedText></Symbol>
      </MeasurementUnit>
      <MeasurementUnit OID="MU.MMHG" Name="mmHg">
        <Symbol><TranslatedText xml:lang="en">mmHg</TranslatedText></Symbol>
      </MeasurementUnit>
      <MeasurementUnit OID="MU.BPM" Name="beats/min">
        <Symbol><TranslatedText xml:lang="en">beats/min</TranslatedText></Symbol>
      </MeasurementUnit>
      <MeasurementUnit OID="MU.CELSIUS" Name="Celsius">
        <Symbol><TranslatedText xml:lang="en">°C</TranslatedText></Symbol>
      </MeasurementUnit>
      <MeasurementUnit OID="MU.KG" Name="kg">
        <Symbol><TranslatedText xml:lang="en">kg</TranslatedText></Symbol>
      </MeasurementUnit>
      <MeasurementUnit OID="MU.CM" Name="cm">
        <Symbol><TranslatedText xml:lang="en">cm</TranslatedText></Symbol>
      </MeasurementUnit>
    </BasicDefinitions>
    <MetaDataVersion OID="${escapeXml(study.id)}.MDV.1" Name="Version ${study.version || '1.0'}">`;

  // FormDef 생성
  for (const form of forms) {
    const formFields = formFieldsMap[form.form_code] || [];
    metadata += `
      <FormDef OID="FORM.${escapeXml(form.form_code)}" Name="${escapeXml(form.form_name)}" Repeating="No">`;
    
    // ItemGroupRef
    metadata += `
        <ItemGroupRef ItemGroupOID="IG.${escapeXml(form.form_code)}" Mandatory="Yes" OrderNumber="1"/>`;
    metadata += `
      </FormDef>`;
  }

  // ItemGroupDef 생성
  for (const form of forms) {
    const formFields = formFieldsMap[form.form_code] || [];
    metadata += `
      <ItemGroupDef OID="IG.${escapeXml(form.form_code)}" Name="${escapeXml(form.form_name)}" Repeating="No">`;
    
    for (let i = 0; i < formFields.length; i++) {
      const field = formFields[i];
      metadata += `
        <ItemRef ItemOID="IT.${escapeXml(form.form_code)}.${escapeXml(field.field_code)}" Mandatory="${field.is_required ? 'Yes' : 'No'}" OrderNumber="${i + 1}"/>`;
    }
    metadata += `
      </ItemGroupDef>`;
  }

  // ItemDef 생성
  for (const form of forms) {
    const formFields = formFieldsMap[form.form_code] || [];
    for (const field of formFields) {
      const dataType = mapFieldTypeToODM(field.field_type);
      metadata += `
      <ItemDef OID="IT.${escapeXml(form.form_code)}.${escapeXml(field.field_code)}" Name="${escapeXml(field.field_name)}" DataType="${dataType}"`;
      
      if (field.max_value) {
        metadata += ` Length="${field.max_value}"`;
      }
      metadata += `>
        <Question><TranslatedText xml:lang="en">${escapeXml(field.field_name)}</TranslatedText></Question>`;
      
      // CodeList for SELECT fields
      if (field.field_type === 'SELECT' && field.options) {
        metadata += `
        <CodeListRef CodeListOID="CL.${escapeXml(form.form_code)}.${escapeXml(field.field_code)}"/>`;
      }
      metadata += `
      </ItemDef>`;
    }
  }

  // CodeList 생성 (SELECT 필드용)
  for (const form of forms) {
    const formFields = formFieldsMap[form.form_code] || [];
    for (const field of formFields) {
      if (field.field_type === 'SELECT' && field.options) {
        let options: any[];
        try {
          options = typeof field.options === 'string' ? JSON.parse(field.options) : field.options;
        } catch {
          continue;
        }
        
        metadata += `
      <CodeList OID="CL.${escapeXml(form.form_code)}.${escapeXml(field.field_code)}" Name="${escapeXml(field.field_name)} Codes" DataType="text">`;
        
        for (const opt of options) {
          const value = typeof opt === 'object' ? opt.value : opt;
          const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
          metadata += `
        <CodeListItem CodedValue="${escapeXml(value)}">
          <Decode><TranslatedText xml:lang="en">${escapeXml(label)}</TranslatedText></Decode>
        </CodeListItem>`;
        }
        metadata += `
      </CodeList>`;
      }
    }
  }

  metadata += `
    </MetaDataVersion>
  </Study>`;

  return metadata;
}

/**
 * 필드 타입을 ODM DataType으로 매핑
 */
function mapFieldTypeToODM(fieldType: string): string {
  const typeMap: Record<string, string> = {
    'TEXT': 'text',
    'TEXTAREA': 'text',
    'NUMBER': 'float',
    'INTEGER': 'integer',
    'DATE': 'date',
    'TIME': 'time',
    'DATETIME': 'datetime',
    'SELECT': 'text',
    'RADIO': 'text',
    'CHECKBOX': 'text',
    'BOOLEAN': 'boolean'
  };
  return typeMap[fieldType] || 'text';
}

/**
 * Clinical Data 생성
 */
function generateClinicalData(studyOID: string, metadataVersionOID: string, subjects: any[], visits: any[], crfData: any[]): string {
  // Subject별 데이터 그룹화
  const subjectDataMap: Record<string, { subject: any; visits: any[]; data: any[] }> = {};
  
  for (const subject of subjects) {
    subjectDataMap[subject.id] = {
      subject,
      visits: [],
      data: []
    };
  }
  
  for (const visit of visits) {
    if (subjectDataMap[visit.subject_id]) {
      subjectDataMap[visit.subject_id].visits.push(visit);
    }
  }
  
  for (const data of crfData) {
    if (subjectDataMap[data.subject_id]) {
      subjectDataMap[data.subject_id].data.push(data);
    }
  }

  let clinicalData = `
  <ClinicalData StudyOID="${escapeXml(studyOID)}" MetaDataVersionOID="${escapeXml(metadataVersionOID)}">`;

  for (const subjectId in subjectDataMap) {
    const { subject, visits, data } = subjectDataMap[subjectId];
    
    clinicalData += `
    <SubjectData SubjectKey="${escapeXml(subject.subject_number)}">
      <SiteRef LocationOID="${escapeXml(subject.site_id)}"/>`;

    // Visit별 데이터
    const visitDataMap: Record<string, any[]> = {};
    for (const d of data) {
      if (!visitDataMap[d.visit_id]) {
        visitDataMap[d.visit_id] = [];
      }
      visitDataMap[d.visit_id].push(d);
    }

    for (const visit of visits) {
      const visitData = visitDataMap[visit.id] || [];
      if (visitData.length === 0) continue;

      // Form별 데이터 그룹화
      const formDataMap: Record<string, any[]> = {};
      for (const d of visitData) {
        if (!formDataMap[d.form_code]) {
          formDataMap[d.form_code] = [];
        }
        formDataMap[d.form_code].push(d);
      }

      clinicalData += `
      <StudyEventData StudyEventOID="SE.${escapeXml(visit.visit_code || visit.visit_name)}" StudyEventRepeatKey="1">`;

      for (const formCode in formDataMap) {
        const formData = formDataMap[formCode];
        
        clinicalData += `
        <FormData FormOID="FORM.${escapeXml(formCode)}" FormRepeatKey="1">
          <ItemGroupData ItemGroupOID="IG.${escapeXml(formCode)}" ItemGroupRepeatKey="1">`;
        
        for (const fd of formData) {
          clinicalData += `
            <ItemData ItemOID="IT.${escapeXml(formCode)}.${escapeXml(fd.field_code)}" Value="${escapeXml(fd.field_value)}"/>`;
        }
        
        clinicalData += `
          </ItemGroupData>
        </FormData>`;
      }

      clinicalData += `
      </StudyEventData>`;
    }

    clinicalData += `
    </SubjectData>`;
  }

  clinicalData += `
  </ClinicalData>`;

  return clinicalData;
}

// =====================================================
// SDTM DOMAIN GENERATORS
// =====================================================

/**
 * SDTM DM (Demographics) Domain 생성
 */
function generateSDTM_DM(subjects: any[], dmData: any[]): string {
  const headers = ['STUDYID', 'DOMAIN', 'USUBJID', 'SUBJID', 'RFSTDTC', 'RFENDTC', 'SITEID', 'BRTHDTC', 'AGE', 'AGEU', 'SEX', 'RACE', 'ETHNIC', 'COUNTRY'];
  
  const rows: string[][] = [];
  
  // Subject별 DM 데이터 매핑
  const dmDataMap: Record<string, Record<string, string>> = {};
  for (const d of dmData) {
    if (!dmDataMap[d.subject_id]) {
      dmDataMap[d.subject_id] = {};
    }
    dmDataMap[d.subject_id][d.field_code] = d.field_value;
  }

  for (const subject of subjects) {
    const subjectDM = dmDataMap[subject.id] || {};
    rows.push([
      subject.study_id || '',                    // STUDYID
      'DM',                                       // DOMAIN
      `${subject.site_number}-${subject.subject_number}`, // USUBJID
      subject.subject_number,                     // SUBJID
      subject.enrolled_date || subject.screening_date || '', // RFSTDTC
      subject.completed_date || '',               // RFENDTC
      subject.site_number || '',                  // SITEID
      subjectDM['BRTHDAT'] || subjectDM['BRTHDTC'] || '', // BRTHDTC
      subjectDM['AGE'] || '',                     // AGE
      'YEARS',                                    // AGEU
      subjectDM['SEX'] || '',                     // SEX
      subjectDM['RACE'] || '',                    // RACE
      subjectDM['ETHNIC'] || '',                  // ETHNIC
      'KOR'                                       // COUNTRY (한국 기본값)
    ]);
  }

  return toCSVString(headers, rows);
}

/**
 * SDTM VS (Vital Signs) Domain 생성
 */
function generateSDTM_VS(subjects: any[], vsData: any[]): string {
  const headers = ['STUDYID', 'DOMAIN', 'USUBJID', 'VSSEQ', 'VSTESTCD', 'VSTEST', 'VSORRES', 'VSORRESU', 'VSSTRESC', 'VSSTRESN', 'VSSTRESU', 'VSSTAT', 'VSLOC', 'VSPOS', 'VSDTC', 'VSDY'];
  
  const rows: string[][] = [];
  let seq = 1;

  // VSTESTCD 매핑
  const vsTestMap: Record<string, { testcd: string; test: string; unit: string }> = {
    'SYSBP': { testcd: 'SYSBP', test: 'Systolic Blood Pressure', unit: 'mmHg' },
    'DIABP': { testcd: 'DIABP', test: 'Diastolic Blood Pressure', unit: 'mmHg' },
    'HR': { testcd: 'HR', test: 'Heart Rate', unit: 'beats/min' },
    'PULSE': { testcd: 'PULSE', test: 'Pulse Rate', unit: 'beats/min' },
    'TEMP': { testcd: 'TEMP', test: 'Temperature', unit: 'C' },
    'RESP': { testcd: 'RESP', test: 'Respiratory Rate', unit: 'breaths/min' },
    'WEIGHT': { testcd: 'WEIGHT', test: 'Weight', unit: 'kg' },
    'HEIGHT': { testcd: 'HEIGHT', test: 'Height', unit: 'cm' },
    'BMI': { testcd: 'BMI', test: 'Body Mass Index', unit: 'kg/m2' }
  };

  // Subject ID -> Subject Number 매핑
  const subjectMap: Record<string, any> = {};
  for (const s of subjects) {
    subjectMap[s.id] = s;
  }

  for (const vs of vsData) {
    const subject = subjectMap[vs.subject_id];
    if (!subject) continue;

    const testInfo = vsTestMap[vs.field_code] || { testcd: vs.field_code, test: vs.field_code, unit: '' };
    
    rows.push([
      subject.study_id || '',                     // STUDYID
      'VS',                                        // DOMAIN
      `${subject.site_number}-${subject.subject_number}`, // USUBJID
      String(seq++),                               // VSSEQ
      testInfo.testcd,                             // VSTESTCD
      testInfo.test,                               // VSTEST
      vs.field_value || '',                        // VSORRES
      testInfo.unit,                               // VSORRESU
      vs.field_value || '',                        // VSSTRESC
      vs.field_value || '',                        // VSSTRESN
      testInfo.unit,                               // VSSTRESU
      '',                                          // VSSTAT
      '',                                          // VSLOC
      '',                                          // VSPOS
      vs.visit_date || '',                         // VSDTC
      ''                                           // VSDY
    ]);
  }

  return toCSVString(headers, rows);
}

/**
 * SDTM AE (Adverse Events) Domain 생성
 */
function generateSDTM_AE(subjects: any[], aeData: any[]): string {
  const headers = ['STUDYID', 'DOMAIN', 'USUBJID', 'AESEQ', 'AETERM', 'AEDECOD', 'AEBODSYS', 'AESEV', 'AESER', 'AEACN', 'AEREL', 'AEOUT', 'AESTDTC', 'AEENDTC'];
  
  const rows: string[][] = [];
  let seq = 1;

  // Subject ID -> Subject 매핑
  const subjectMap: Record<string, any> = {};
  for (const s of subjects) {
    subjectMap[s.id] = s;
  }

  // CRF Instance별 AE 데이터 그룹화
  const aeByInstance: Record<string, Record<string, string>> = {};
  for (const ae of aeData) {
    if (!aeByInstance[ae.crf_instance_id]) {
      aeByInstance[ae.crf_instance_id] = { subject_id: ae.subject_id };
    }
    aeByInstance[ae.crf_instance_id][ae.field_code] = ae.field_value;
  }

  for (const instanceId in aeByInstance) {
    const aeRecord = aeByInstance[instanceId];
    const subject = subjectMap[aeRecord.subject_id];
    if (!subject) continue;

    rows.push([
      subject.study_id || '',                     // STUDYID
      'AE',                                        // DOMAIN
      `${subject.site_number}-${subject.subject_number}`, // USUBJID
      String(seq++),                               // AESEQ
      aeRecord['AETERM'] || '',                    // AETERM
      aeRecord['AEDECOD'] || aeRecord['AETERM'] || '', // AEDECOD
      aeRecord['AEBODSYS'] || '',                  // AEBODSYS
      aeRecord['AESEV'] || '',                     // AESEV
      aeRecord['AESER'] || '',                     // AESER
      aeRecord['AEACN'] || '',                     // AEACN
      aeRecord['AEREL'] || '',                     // AEREL
      aeRecord['AEOUT'] || '',                     // AEOUT
      aeRecord['AESTDTC'] || '',                   // AESTDTC
      aeRecord['AEENDTC'] || ''                    // AEENDTC
    ]);
  }

  return toCSVString(headers, rows);
}

/**
 * CSV 문자열 생성
 */
function toCSVString(headers: string[], rows: string[][]): string {
  const escapeCSV = (value: string): string => {
    if (!value) return '';
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map(row => row.map(escapeCSV).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

// =====================================================
// API ENDPOINTS
// =====================================================

// GET /api/cdisc/odm - ODM XML Export
app.get('/odm', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const { study_id, include_metadata = 'true', include_clinical_data = 'true' } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // Study 정보 조회
    const study = await c.env.DB.prepare(`
      SELECT * FROM studies WHERE id = ?
    `).bind(study_id).first();

    if (!study) {
      return c.json({ error: 'Study를 찾을 수 없습니다.' }, 404);
    }

    // Form 정의 조회
    const forms = await c.env.DB.prepare(`
      SELECT * FROM form_definitions WHERE study_id = ? ORDER BY form_order
    `).bind(study_id).all();

    // Field 정의 조회
    const fields = await c.env.DB.prepare(`
      SELECT fd.*, frm.form_code
      FROM field_definitions fd
      JOIN form_definitions frm ON fd.form_definition_id = frm.id
      WHERE frm.study_id = ?
      ORDER BY frm.form_order, fd.field_order
    `).bind(study_id).all();

    // Subject 조회
    const subjects = await c.env.DB.prepare(`
      SELECT s.*, site.site_number, site.study_id
      FROM subjects s
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).all();

    // Visit 조회
    const visits = await c.env.DB.prepare(`
      SELECT v.*, s.id as subject_id
      FROM visits v
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).all();

    // CRF Data 조회
    const crfData = await c.env.DB.prepare(`
      SELECT cd.*, ci.form_code, ci.visit_id, v.actual_date as visit_date, s.id as subject_id
      FROM crf_data cd
      JOIN crf_instances ci ON cd.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).all();

    // ODM XML 생성
    const creationDateTime = now();
    let odm = generateODMHeader(study_id, creationDateTime);

    if (include_metadata === 'true') {
      odm += generateStudyMetadata(study, forms.results as any[], fields.results as any[]);
    }

    if (include_clinical_data === 'true') {
      odm += generateClinicalData(
        study_id,
        `${study_id}.MDV.1`,
        subjects.results as any[],
        visits.results as any[],
        crfData.results as any[]
      );
    }

    odm += '\n</ODM>';

    // 감사 로그
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: 'cdisc_odm',
      recordId: study_id,
      newValue: JSON.stringify({ format: 'ODM', subjects: subjects.results?.length || 0 })
    });

    return new Response(odm, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${study_id}_ODM_${creationDateTime.split('T')[0]}.xml"`
      }
    });

  } catch (error: any) {
    console.error('ODM Export error:', error);
    return c.json({ error: 'ODM Export 실패', details: error?.message }, 500);
  }
});

// GET /api/cdisc/sdtm/:domain - SDTM Domain Export
app.get('/sdtm/:domain', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    if (!hasPermission(user.role, 'EXPORT_DATA')) {
      return c.json({ error: '데이터 내보내기 권한이 없습니다.' }, 403);
    }

    const domain = c.req.param('domain').toUpperCase();
    const { study_id, format = 'csv' } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    const validDomains = ['DM', 'VS', 'AE', 'CM', 'MH', 'LB'];
    if (!validDomains.includes(domain)) {
      return c.json({ error: `지원되지 않는 도메인입니다. 지원 도메인: ${validDomains.join(', ')}` }, 400);
    }

    // Subject 조회
    const subjects = await c.env.DB.prepare(`
      SELECT s.*, site.site_number, site.study_id
      FROM subjects s
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ?
    `).bind(study_id).all();

    // 도메인별 Form Code 매핑
    const domainFormMap: Record<string, string[]> = {
      'DM': ['DM'],
      'VS': ['VS'],
      'AE': ['AE'],
      'CM': ['CM'],
      'MH': ['MH'],
      'LB': ['LB']
    };

    const formCodes = domainFormMap[domain] || [domain];

    // CRF Data 조회
    const crfData = await c.env.DB.prepare(`
      SELECT cd.*, ci.form_code, ci.id as crf_instance_id, v.actual_date as visit_date, s.id as subject_id
      FROM crf_data cd
      JOIN crf_instances ci ON cd.crf_instance_id = ci.id
      JOIN visits v ON ci.visit_id = v.id
      JOIN subjects s ON v.subject_id = s.id
      JOIN sites site ON s.site_id = site.id
      WHERE site.study_id = ? AND ci.form_code IN (${formCodes.map(() => '?').join(',')})
    `).bind(study_id, ...formCodes).all();

    // 도메인별 SDTM 데이터 생성
    let sdtmData: string;
    switch (domain) {
      case 'DM':
        sdtmData = generateSDTM_DM(subjects.results as any[], crfData.results as any[]);
        break;
      case 'VS':
        sdtmData = generateSDTM_VS(subjects.results as any[], crfData.results as any[]);
        break;
      case 'AE':
        sdtmData = generateSDTM_AE(subjects.results as any[], crfData.results as any[]);
        break;
      default:
        // 기본 형식 (Long format)
        const headers = ['STUDYID', 'DOMAIN', 'USUBJID', 'FIELD_CODE', 'FIELD_VALUE', 'VISIT_DATE'];
        const subjectMap: Record<string, any> = {};
        for (const s of subjects.results as any[]) {
          subjectMap[s.id] = s;
        }
        const rows = (crfData.results as any[]).map((d: any) => {
          const subject = subjectMap[d.subject_id];
          return [
            study_id,
            domain,
            subject ? `${subject.site_number}-${subject.subject_number}` : '',
            d.field_code,
            d.field_value,
            d.visit_date || ''
          ];
        });
        sdtmData = toCSVString(headers, rows);
    }

    // 감사 로그
    const auditContext: AuditContext = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionId: user.sessionId,
        iat: user.iat,
        exp: user.exp
      },
      ipAddress: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      userAgent: c.req.header('User-Agent') || 'unknown',
      sessionId: user.sessionId,
      studyId: study_id
    };

    await createAuditLog(c.env.DB, auditContext, {
      action: 'EXPORT',
      tableName: `sdtm_${domain.toLowerCase()}`,
      recordId: study_id,
      newValue: JSON.stringify({ domain, format })
    });

    if (format === 'json') {
      // CSV를 JSON으로 변환
      const lines = sdtmData.split('\r\n');
      const headers = lines[0].split(',');
      const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = values[i] || '';
        });
        return obj;
      });
      return c.json({ domain, study_id, data });
    }

    return new Response(sdtmData, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${domain}_${study_id}_${now().split('T')[0]}.csv"`
      }
    });

  } catch (error: any) {
    console.error('SDTM Export error:', error);
    return c.json({ error: 'SDTM Export 실패', details: error?.message }, 500);
  }
});

// GET /api/cdisc/domains - 사용 가능한 SDTM 도메인 목록
app.get('/domains', async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user) {
      return c.json({ error: '인증이 필요합니다.' }, 401);
    }

    const { study_id } = c.req.query();

    if (!study_id) {
      return c.json({ error: 'study_id가 필요합니다.' }, 400);
    }

    // 사용 가능한 Form 목록 조회
    const forms = await c.env.DB.prepare(`
      SELECT DISTINCT form_code, form_name FROM form_definitions WHERE study_id = ?
    `).bind(study_id).all();

    // Form Code -> SDTM Domain 매핑
    const formToDomain: Record<string, { domain: string; description: string }> = {
      'DM': { domain: 'DM', description: 'Demographics' },
      'VS': { domain: 'VS', description: 'Vital Signs' },
      'AE': { domain: 'AE', description: 'Adverse Events' },
      'CM': { domain: 'CM', description: 'Concomitant Medications' },
      'MH': { domain: 'MH', description: 'Medical History' },
      'LB': { domain: 'LB', description: 'Laboratory Tests' },
      'PE': { domain: 'PE', description: 'Physical Examination' },
      'EG': { domain: 'EG', description: 'ECG' },
      'DA': { domain: 'DA', description: 'Drug Accountability' }
    };

    const availableDomains = (forms.results as any[])
      .filter(f => formToDomain[f.form_code])
      .map(f => ({
        form_code: f.form_code,
        form_name: f.form_name,
        sdtm_domain: formToDomain[f.form_code].domain,
        sdtm_description: formToDomain[f.form_code].description
      }));

    return c.json({
      study_id,
      available_domains: availableDomains,
      export_formats: ['csv', 'json'],
      odm_available: true
    });

  } catch (error: any) {
    console.error('Domains list error:', error);
    return c.json({ error: '도메인 목록 조회 실패', details: error?.message }, 500);
  }
});

export default app;
