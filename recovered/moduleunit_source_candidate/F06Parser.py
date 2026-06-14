import os


class F06Parser:
  """
  Nastran f06 결과 파일을 파싱하여 특정 텍스트(예: FATAL)를 추출하는 유틸리티 클래스입니다.
  """

  @staticmethod
  def extract_fatal_errors(f06_filepath, context_lines=10):
    """
    .f06 파일에서 'FATAL' 문자열을 찾아 전후 문맥을 포함해 반환합니다.

    Args:
        f06_filepath (str): 파싱할 f06 파일의 절대 경로
        context_lines (int): 에러 발생 기준 앞뒤로 가져올 줄 수

    Returns:
        list: 추출된 텍스트 라인들의 리스트
    """
    if not os.path.exists(f06_filepath):
      return ["f06 파일이 존재하지 않습니다.\n"]

    extracted_lines = []
    try:
      with open(f06_filepath, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()

      for i, line in enumerate(lines):
        if 'FATAL' in line.upper():
          start_idx = max(0, i - context_lines)
          end_idx = min(len(lines), i + context_lines + 1)

          extracted_lines.append(f"\n{'=' * 50}\n")
          extracted_lines.append(f"🚨 FATAL ERROR DETECTED (Line {i + 1}) 🚨\n")
          extracted_lines.append(f"{'=' * 50}\n")

          for j in range(start_idx, end_idx):
            extracted_lines.append(lines[j])

          extracted_lines.append(f"{'=' * 50}\n\n")

      if not extracted_lines:
        extracted_lines.append("f06 파일 내에 'FATAL' 문자열이 발견되지 않았습니다.\n")

    except Exception as e:
      extracted_lines.append(f"f06 파일 파싱 중 오류 발생: {str(e)}\n")

    return extracted_lines