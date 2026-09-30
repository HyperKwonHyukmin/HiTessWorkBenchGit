const GUIDANCE = {
  EMPTY_RIGID_EXCLUDED: ['연결 대상 없는 RBE2 제외', '종속 노드가 없어 연결 조건을 제공하지 않는 RBE2만 제외했습니다. 연결된 노드·배관·질량·구속조건은 보존했습니다.', '제외 내역을 기록했습니다. 해당 U-bolt의 지지 연결은 생성되지 않았으므로 설계상 필요한 지지인지 검토할 때 참고하세요.'],
  MISSING_PROPERTY: ['단면 정보 누락', '요소가 참조하는 단면 번호가 모델에 없습니다.', '대상 요소의 입력 단면과 변환·편집 내역을 확인하고 단면 정보를 수정한 뒤 모델을 다시 생성하세요.'],
  MISSING_MATERIAL: ['재료 정보 누락', '단면이 참조하는 재료 번호가 모델에 없습니다.', '원문에 표시된 단면과 재료 번호를 확인하세요. 재료 지정 정보를 수정하거나 진단 파일을 엔진 담당자에게 전달하세요.'],
  EMPTY_RIGID: ['연결 대상이 없는 강체 요소', 'RBE2의 종속 노드가 없어 유효한 강체 연결을 만들 수 없습니다.', 'Studio에서 기준 노드와 주변 부재를 확인하세요. 필요한 연결이면 올바른 대상 노드로 RBE를 다시 생성하고, 불필요한 연결이면 해당 RBE만 제거한 뒤 편집 적용·재검증하세요. 입력을 수정하지 않아도 발생하면 진단 파일과 CSV를 담당자에게 전달하세요.'],
  RBE2_DEPENDENT_DOF_CONFLICT: ['강체 요소의 종속 자유도 중복', '같은 노드의 자유도가 여러 RBE2에 중복 종속되어 해석이 중단될 수 있습니다.', '원문에 표시된 RBE2들을 확인하고 연결을 하나로 정리하거나 구속 자유도가 중복되지 않도록 수정한 뒤 재검증하세요.'],
  RBE2_CIRCULAR_DEPENDENCY: ['강체 연결 순환', 'RBE2의 기준·종속 관계가 순환하여 해석 행렬이 특이해질 수 있습니다.', '원문의 노드 연결 순서를 확인하고 순환을 만드는 RBE 연결을 수정한 뒤 재검증하세요.'],
  ZERO_LENGTH_ELEMENT: ['길이가 0인 요소', '요소 양 끝 노드가 같은 위치에 있어 해석에 사용할 수 없습니다.', '대상 요소의 끝점과 CSV 좌표를 확인하세요. 불필요한 요소를 제거하거나 끝점을 수정한 뒤 모델을 다시 생성하세요.'],
  EMPTY_MODEL: ['요소가 없는 모델', '변환 후 해석할 요소가 남지 않았습니다.', '입력 감사에서 제외 행과 단면·좌표 오류를 확인하고 CSV를 수정한 뒤 다시 실행하세요.'],
  ID_OVERFLOW: ['BDF 번호 범위 초과', '모델 번호가 BDF small-field 형식의 허용 범위를 초과했습니다.', '모델 번호 재정렬 또는 출력 형식 변경이 필요합니다. 진단 파일과 입력을 엔진 담당자에게 전달하세요.'],
  MISSING_NODE: ['참조 노드 누락', '요소가 모델에 존재하지 않는 노드를 참조합니다.', '대상 요소와 삭제·병합 내역을 확인하고 연결을 수정한 뒤 재검증하세요.'],
  FREE_END_NODE: ['자유단 노드', '노드가 한 요소에만 연결되어 있습니다. 실제 자유단일 수도 있습니다.', '의도된 자유단인지 도면과 비교하세요. 누락된 연결일 때만 수정하고 재검증하세요.'],
  SHORT_ELEMENT: ['짧은 요소', '요소 길이가 검증 기준보다 짧습니다.', '좌표·메시 크기와 주변 연결을 확인하고 필요한 경우 메시를 조정하세요.'],
}
export function describeDiagnostic(d) {
  const [title, cause, action] = GUIDANCE[d.code] ?? [
    d.code || '모델 진단',
    d.message || '상세 설명이 없습니다.',
    '원문과 대상 번호를 확인하세요. 판단이 어려우면 진단 파일과 입력 CSV를 담당자에게 전달하세요.',
  ]
  return { title, cause, action }
}
export function enrichDiagnostic(d, model) {
  const rigidCheck = d.code === 'EMPTY_RIGID' || d.code?.startsWith('RBE2_') || d.code?.startsWith('BOX_UBOLT_')
  const id = d.elemId ?? d.elementId
  const entity = (rigidCheck ? model.rigids : model.elements)?.find(e => e.id === id)
  const node = model.nodeMap?.get(d.nodeId) ?? model.nodes?.find(n => n.id === d.nodeId)
  const recordedSource = d.code === 'EMPTY_RIGID_EXCLUDED' ? d.message?.match(/SourceName=([^;]*);/)?.[1] : null
  return { ...d, sourceName: entity?.sourceName ?? d.sourceName ?? recordedSource ?? '',
    positionMm: node ? [node.x, node.y, node.z] : d.positionMm }
}
export function downloadDiagnostics(diagnostics, name = 'HiTESS_Validation') {
  const rows = [['등급', '코드', '요소/RBE 번호', '노드 번호', '입력 이름', '좌표(mm)', '원인', '조치', '원문'],
    ...diagnostics.map(d => {
      const g = describeDiagnostic(d)
      return [d.severity, d.code, d.elemId ?? d.elementId, d.nodeId, d.sourceName, d.positionMm?.join(', '), g.cause, g.action, d.message]
    })]
  const csv = '\uFEFF' + rows.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
