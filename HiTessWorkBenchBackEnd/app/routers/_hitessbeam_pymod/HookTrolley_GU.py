from .hmNastran import hmNastranBDF_Importer, hmNastranBDF_Exporter, hmNastranOP2_Analyzer
from pyNastran.bdf.case_control_deck import CaseControlDeck
import numpy as np
import math
from .CalcFunc import CalcFunc
from .F06Parser import F06Parser
import os
import copy
from collections import Counter
from collections import defaultdict, deque
import subprocess
import sys
import re


class HookTrolley_GU(hmNastranBDF_Importer, hmNastranBDF_Exporter, CalcFunc):
  def __init__(self, filename, export_bdf, liftingPoints, lineLength, Safety_Factor=1.0, lifting_method=0,
               analysis=True, debugPrint=False):
    self.filename = filename
    self.new_bdf = export_bdf
    self.liftingPoints = liftingPoints
    self.lineLength = lineLength
    self.lifting_method = lifting_method
    self.analysis = analysis
    self.debugPrint = debugPrint
    self.ModuleUnitResultText_list = []
    hmNastranBDF_Importer.__init__(self, self.filename)
    hmNastranBDF_Exporter.__init__(self, self.filename)

    # Gravity = -1.0
    # Gravity 지정값 넣어주기
    with open(self.filename, 'r', encoding='utf-8') as f:
      for line in f:
        # 공백 제거 후 시작이 GRAV로 시작하는지 확인
        if line.strip().startswith("GRAV"):
          # 각 열은 8칸 폭으로 고정
          fields = [line[i:i + 8].strip() for i in range(0, len(line), 8)]
          if len(fields) >= 7:
            try:
              Gravity = float(fields[6])  # 7번째 필드가 가속도 방향 값
            except ValueError:
              pass  # 숫자 변환 실패 시 무시

    self.Safety_Factor = Gravity

  def HookTrolleyRun(self):

    hmNastranBDF_Importer.run(self)

    '''
    # HookTrolley-
    input_list에 사용자로 부터 2중 리스트를 입력받으며 이는 Hook의 권상포인트 그룹이다.
    이 단계는 권상 포인트를 계산을 위해 배치 순서를 변경한다.
    '''
    self.LiftingPointSetting(self.debugPrint)
    ##########################

    '''
    # HookTrolley-
    LiftingPoint들이 이루는 형태가 어떤 형태인지 확인, "4개 점 일직선", "4개 점 사각형", "3개 점", "2개 점"을 별도딕셔너리에 추가해준다.
    '''
    self.LiftingPointShapeDetecter(self.debugPrint)

    ##########################
    '''
    # HookTrolley-
    LiftingPoint들이 이루는 형태가 타당한지를 확인
    '''
    self.LiftingPointVerifier(self.debugPrint)

    ###########################
    '''
    # HookTrolley-
    HookTrolley 위치 계산
    '''
    if self.lifting_method == 0:
      self.HookLocationCalc(self.debugPrint)  # Hidro
    else:
      self.TrolleyLocationCalc(self.debugPrint)  # Gliat
    #############################
    '''
    # HookTrolley-
    HookTrolley 개수가 2개 일 때, HookTrolley 위치를 COG 중심으로 수정
    '''
    self.HooktoCOG()
    ############################
    '''
    # HookTrolley-
    계산된 TrolleyLocation_list가 이루는 사각형(4개점) 또는 삼각형(3개점) 내부에 COG가 존재하는지 확인
    '''
    # self.Overturn(self.debugPrint)
    #############################
    '''
    # HookTrolley-
    Trolley의 경우에 LiftingPoint를 900mm간격으로 별려준다.
    '''
    if self.lifting_method == 1:
      self.TrolleyLiftingPointSplitter(self.debugPrint)
    ############################
    '''
    # HookTrolley-
    배관에서 RBE 중에 1번 경계 조건이 없는 경우 날라가므로, 배관에 1번이 하나라도 없으면 무게 중신에 가까운 Node에 SPC설정
    모델이 날라가는 것 방지를 위해 무게중심 위치에 12방향 경계조건 추가
    '''
    self.Pipe_SPCSetter(self.debugPrint)
    self.COG_SPCSetter(self.debugPrint)
    #############################
    '''
    # HookTrolley-
    계산된 LiftingPoint로 새로운 Rod로 생성하여 연결하여 BDF 출력
    '''
    self.BDF_Exporter()
    self.BDF_InfogetEdit(self.debugPrint)
    #############################
    '''
    # # HookTrolley-
    # Nastran 해석 수행
    # '''
    if self.analysis == True:
      self.Analysis(self.debugPrint)

    '''
    # HookTrolley-
    해석 결과 응력 정리, 반력의 경우에 음수가 나오면 위치를 잘못잡은거고 Trolley 는 평균 값을 쓰고, hook는 값 그대로 사용
    '''
    self.AssessmentResults()

  ## 함수 정의 부분 ########################
  def LiftingPointSetting(self, debugPrint):
    '''
    # HookTrolley-01
    input_list에 사용자로 부터 2중 리스트를 입력받으며 이는 Hook의 권상포인트 그룹
    이 단계는 권상 포인트를 계산을 위해 배치 순서를 변경한다.
    '''
    self.HookTrolleyLiftingPoint_list = []
    for i in self.liftingPoints:
      if len(i) == 4:  # Hook의 권상포인트 개수가 4개 일 때
        hook_temp_list = []
        for j in i:
          NodeID = j
          X = self.nodes_dict[j]['X']
          Y = self.nodes_dict[j]['Y']
          Z = self.nodes_dict[j]['Z']
          SQRT = (X ** 2 + Y ** 2) ** 0.5
          data = [NodeID, X, Y, Z, SQRT]
          hook_temp_list.append(data)
        hook_temp_list.sort(key=lambda x: x[-1])  # SQRT 기준으로 오름정렬
        SQRT_max_hook = hook_temp_list[-1]  # SQRT가 가장 큰 위치를 지정
        for k in range(len(hook_temp_list)):
          X_hook = hook_temp_list[k][1]
          Y_hook = hook_temp_list[k][2]
          P = ((X_hook - SQRT_max_hook[1]) ** 2 + (Y_hook - SQRT_max_hook[2]) ** 2) ** 0.5
          hook_temp_list[k].append(P)
        hook_temp_list.sort(key=lambda x: x[1])  # X 기준으로 내림정렬
        # Hook 평가되는 순서대로 리스트의 순서를 변경
        temp = hook_temp_list[1]
        hook_temp_list[1] = hook_temp_list[2]
        hook_temp_list[2] = temp
        self.HookTrolleyLiftingPoint_list.append(hook_temp_list)

      elif len(i) == 3:  # Hook의 권상포인트 개수가 3개 일 때, 이거 테스트 해봐야 함
        hook_temp_list = []
        for j in i:
          NodeID = j
          X = self.nodes_dict[j]['X']
          Y = self.nodes_dict[j]['Y']
          Z = self.nodes_dict[j]['Z']
          data = [NodeID, X, Y, Z]
          hook_temp_list.append(data)
        hook_temp_list.sort(key=lambda x: x[1])  # X 기준으로 내림정렬
        # Hook 평가되는 순서대로 리스트의 순서를 변경
        temp = hook_temp_list[1]
        hook_temp_list[1] = hook_temp_list[2]
        hook_temp_list[2] = temp
        self.HookTrolleyLiftingPoint_list.append(hook_temp_list)

      elif len(i) == 2:  # Hook의 권상포인트 개수가 2개 일 때,
        hook_temp_list = []
        for j in i:
          NodeID = j
          X = self.nodes_dict[j]['X']
          Y = self.nodes_dict[j]['Y']
          Z = self.nodes_dict[j]['Z']
          data = [NodeID, X, Y, Z]
          hook_temp_list.append(data)
        hook_temp_list.sort(key=lambda x: x[1])  # X 기준으로 내림정렬
        self.HookTrolleyLiftingPoint_list.append(hook_temp_list)

    if debugPrint:
      print()
      print("## 1단계 : 유닛 포인트 정렬 ")
      for group in self.HookTrolleyLiftingPoint_list:
        for node in group:
          print(node[0], end=" ")
        print()
      print()

  def LiftingPointShapeDetecter(self, debugPrint):
    '''
    # HookTrolley-
    LiftingPoint들이 이루는 형태가 어떤 형태인지 확인, "4개 점 일직선", "4개 점 사각형", "3개 점", "2개 점"을 별도딕셔너리에 추가해준다.
    '''
    self.shapeDetectorDict = {}  # 딕셔너리로 key: SET번호, value : 형태 이렇게 생성

    def is_almost_line_in_direction(points, tolerance=0.1):
      # 모든 점 쌍 사이의 벡터를 계산합니다.
      vectors = [np.array(p2) - np.array(p1) for p1 in points for p2 in points if p1 != p2]
      # 각 벡터를 단위 벡터로 변환합니다.
      unit_vectors = [v / np.linalg.norm(v) for v in vectors if np.linalg.norm(v) != 0]
      # X축과 Y축 방향에 대한 플래그를 초기화합니다.
      almost_line_in_x = True
      almost_line_in_y = True
      for v in unit_vectors:
        # 벡터가 X축과 거의 평행한지 확인합니다.
        if abs(v[0]) < 1 - tolerance:
          almost_line_in_x = False
        # 벡터가 Y축과 거의 평행한지 확인합니다.
        if abs(v[1]) < 1 - tolerance:
          almost_line_in_y = False
      # 일직선 방향을 반환합니다 (X, Y, 또는 None).
      if almost_line_in_x:
        return "X"
      elif almost_line_in_y:
        return "Y"
      else:
        return "None"

    def calculate_distance(p1, p2):
      # 두 점 사이의 유클리디안 거리를 계산합니다.
      return np.linalg.norm(np.array(p1) - np.array(p2))

    def is_quadrilateral(points):
      # 모든 점 쌍 사이의 거리를 계산합니다.
      distances = [calculate_distance(points[i], points[j]) for i in range(len(points)) for j in
                   range(i + 1, len(points))]
      # 볼록 4각형 조건을 검사합니다: 어떤 세 변의 길이 합이 나머지 한 변의 길이보다 커야 합니다.
      return all(sum(distances) - d > d for d in distances)

    for i, node_set in enumerate(self.HookTrolleyLiftingPoint_list):
      # 각 노드 세트에서 좌표를 추출합니다.
      coordinates = [node[1:4] for node in node_set]
      # 좌표의 수가 4개일 때, 그것이 거의 일직선 형태인지, 사각형 형태인지를 판단합니다.
      if len(coordinates) == 4:
        direction = is_almost_line_in_direction(coordinates)
        if direction != "None":
          # 점들이 거의 일직선에 있는 경우, 방향을 기록합니다.
          self.shapeDetectorDict[f'SET{i + 1}'] = f"4개점 일직선 형태, 방향: {direction}"
          # 4개 점 일직선 형태일때 X, Y 방향에 따라 오른차순 정렬을 해준다.
          if direction == 'X':
            node_set.sort(key=lambda x: x[1])
          elif direction == 'Y':
            node_set.sort(key=lambda x: x[2])
        elif is_quadrilateral(coordinates):
          # 점들이 4각형을 형성하는 경우를 기록합니다.
          self.shapeDetectorDict[f'SET{i + 1}'] = "4개점 사각형 형태"
      elif len(coordinates) == 2:
        self.shapeDetectorDict[f'SET{i + 1}'] = "2개점"
      elif len(coordinates) == 3:
        self.shapeDetectorDict[f'SET{i + 1}'] = "3개점"

    if debugPrint:
      print("## 2단계 : 유닛 포인트 형태 확인 ")
      for i in self.shapeDetectorDict.items():
        print(i)
      print()

  def LiftingPointVerifier(self, debugPrint):
    '''
    # HookTrolley-
    LiftingPoint들이 이루는 형태가 타당한지를 확인
    '''
    for i, s in enumerate(self.HookTrolleyLiftingPoint_list):  # HookTrolley-01에서 정렬한 리스트를 사용
      if len(s) == 4:  # HookTrolley 권상포인트 개수가 4개 일 때
        if self.shapeDetectorDict[f'SET{i + 1}'] == '4개점 사각형 형태':  # HookTrolley 권상포인트 형태가가 사각형 일 때, 일직선 제외
          vector_temp_list = []
          for j in s:
            X = j[1]
            Y = j[2]
            Z = j[3]
            data = [X, Y, Z]
            data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
            vector_temp_list.append(data)
          max_Z = max(vector_temp_list, key=lambda x: x[2])[2]
          min_Z = min(vector_temp_list, key=lambda x: x[2])[2]
          deg_1 = abs(
            self.degree(vector_temp_list[2] - vector_temp_list[0], vector_temp_list[1] - vector_temp_list[0]) - 90)
          deg_2 = abs(
            self.degree(vector_temp_list[0] - vector_temp_list[1], vector_temp_list[3] - vector_temp_list[1]) - 90)
          deg_3 = abs(
            self.degree(vector_temp_list[0] - vector_temp_list[2], vector_temp_list[3] - vector_temp_list[2]) - 90)
          deg_4 = abs(
            self.degree(vector_temp_list[1] - vector_temp_list[3], vector_temp_list[2] - vector_temp_list[3]) - 90)
          max_deg = max(deg_1, deg_2, deg_3, deg_4)
          # 평가 확인
          try:
            # 평가 확인
            if abs(max_Z - min_Z) > 100 or max_deg > 10:
              raise ValueError("Sling belt 네 점이 직사각형에 가깝지 않음")


          except ValueError as e:
            # [수정 후 코드] "##" 제거 및 텍스트 간결화
            self.ModuleUnitResultText_list.append("1. Unit Point 형태 유효성 확인 : Fail\n")
            self.ModuleUnitResultText_list.append("Sling belt 네 점이 직사각형에 가깝지 않음\n\n")
            if debugPrint:
              print(f"오류 발생: {e}")

            return  # ✅ 원래대로: 여기서 종료

      elif len(s) == 3:  # Hook의 권상포인트 개수가 3개 일 때
        vector_temp_list = []
        for j in s:
          X = j[1]
          Y = j[2]
          Z = j[3]
          data = [X, Y, Z]
          data = np.array(data)  # 넘파이 Array로 변 (Degree 계산을 위해)
          vector_temp_list.append(data)
        vector12 = self.length(vector_temp_list[0], vector_temp_list[1])
        vector23 = self.length(vector_temp_list[1], vector_temp_list[2])
        vector31 = self.length(vector_temp_list[2], vector_temp_list[0])
        vector = [vector12, vector23, vector31]
        vector.sort(reverse=True)
        # 평가 확인
        try:
          if (vector[0]) ** 2 > (vector[1]) ** 2 + (vector[2]) ** 2:
            raise ValueError("Sling belt 세 점이 둔각 삼각형에 가까움")
        except ValueError as e:
          # [수정 후 코드] "##" 제거 및 텍스트 간결화
          self.ModuleUnitResultText_list.append("1. Unit Point 형태 유효성 확인 : Fail\n")
          self.ModuleUnitResultText_list.append("Sling belt 세 점이 둔각 삼각형에 가까움\n\n")
          print(f"오류 발생: {e}")
          return

        # [수정 후 코드] "##" 제거 및 텍스트 간결화
      self.ModuleUnitResultText_list.append("1. Unit Point 형태 유효성 확인 : OK\n\n")
      if debugPrint:
        print("## 3단계 : 유닛 포인트 형태 유효성 확인 : 문제 없음 ")
        print()


  def HookLocationCalc(self, debugPrint):
    '''
    # HookTrolley-
    HookTrolley 위치 계산
    '''
    self.HookTrolleyLocation = []
    for i in range(len(self.HookTrolleyLiftingPoint_list)):  # HookTrolley의-01에서 정렬한 리스트를 사용
      value_l = self.lineLength[i] * 1000 - 100
      if len(self.HookTrolleyLiftingPoint_list[i]) == 4:  # HookTrolley의 권상포인트 개수가 4개 일 때
        if self.shapeDetectorDict[f'SET{i + 1}'] == '4개점 사각형 형태':  # 4개점, 사각형 형태일때 계산 수행
          sorted_by_y = sorted(self.HookTrolleyLiftingPoint_list[i], key=lambda x: x[2])

          # 아래변(가장 작은 Y값을 가진 두 노드)과 윗변(그 다음 작은 Y값을 가진 두 노드)을 구분
          lower_edge = sorted(sorted_by_y[:2], key=lambda x: x[1])  # Y축이 작은 두 노드를 X축 기준으로 정렬
          upper_edge = sorted(sorted_by_y[2:], key=lambda x: x[1])  # 나머지 두 노드를 X축 기준으로 정렬

          # 아래변과 윗변을 순서대로 합침
          sorted_correctly = lower_edge + upper_edge
          vector_temp_list = []
          for j in sorted_correctly:
            X = j[1]
            Y = j[2]
            Z = j[3]
            data = [X, Y, Z]
            data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
            vector_temp_list.append(data)
          vector_12 = vector_temp_list[1] - vector_temp_list[0]
          vector_23 = vector_temp_list[2] - vector_temp_list[1]
          vector_C = 0.25 * (vector_temp_list[0] + vector_temp_list[1] + vector_temp_list[2] + vector_temp_list[3])

          vector_1C = vector_C - vector_temp_list[0]
          value_s = self.mag(vector_1C)
          value_h = math.sqrt(value_l ** 2 - value_s ** 2)
          unit_vector_h = np.cross(vector_12, vector_23) / self.mag(np.cross(vector_12, vector_23))
          H = vector_C + unit_vector_h[2] * value_h * unit_vector_h
          self.HookTrolleyLocation.append(H)

        else:  # 4개점 일직선 형태라면 여기가 수행된다.
          if self.shapeDetectorDict[f'SET{i + 1}'] == '4개점 일직선 형태, 방향: X':  # 4개점, 일직선 형태일때 계산 수행 (X방향)
            self.HookTrolleyLiftingPoint_list[i].sort(key=lambda x: x[1])  # X좌표 기준 정렬
          elif self.shapeDetectorDict[f'SET{i + 1}'] == '4개점 일직선 형태, 방향: Y':  # 4개점, 일직선 형태일때 계산 수행 (Y방향)
            self.HookTrolleyLiftingPoint_list[i].sort(key=lambda x: x[2])  # Y좌표 기준 정렬
          # HookTrolley의의 권상 포인트 2개의 계산과정과 동일한, 즉 4개의 권상 포인트 가운데 2개만 이용하여 계산
          vector_temp_list = [np.array(self.HookTrolleyLiftingPoint_list[i][1][1:4]),
                              np.array(self.HookTrolleyLiftingPoint_list[i][2][1:4])]
          vector_K = 0.5 * (vector_temp_list[0] + vector_temp_list[1])
          vector_12 = vector_K - vector_temp_list[0]
          unit_vector_12 = (1 / self.mag(vector_12)) * vector_12
          value_h = math.sqrt(value_l ** 2 - self.mag(vector_12) ** 2)
          unit_vector_h = np.array(
            [-unit_vector_12[0] * unit_vector_12[2] / math.sqrt(unit_vector_12[0] ** 2 + unit_vector_12[1] ** 2),
             -unit_vector_12[1] * unit_vector_12[2] / math.sqrt(
               unit_vector_12[0] ** 2 + unit_vector_12[1] ** 2),
             math.sqrt(unit_vector_12[0] ** 2 + unit_vector_12[1] ** 2)])
          H = vector_K + value_h * unit_vector_h
          self.HookTrolleyLocation.append(H)

      elif len(self.HookTrolleyLiftingPoint_list[i]) == 3:  # HookTrolley의 권상포인트 개수가 3개 일 때
        vector_temp_list = []
        for j in self.HookTrolleyLiftingPoint_list[i]:
          X = j[1]
          Y = j[2]
          Z = j[3]
          data = [X, Y, Z]
          data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
          vector_temp_list.append(data)
        vector_12 = vector_temp_list[1] - vector_temp_list[0]
        vector_13 = vector_temp_list[2] - vector_temp_list[0]
        vector_23 = vector_temp_list[2] - vector_temp_list[1]
        vector_K = 0.5 * (vector_temp_list[0] + vector_temp_list[1])
        vector_1K = vector_K - vector_temp_list[0]
        vector_C = vector_K + 0.5 * ((np.inner(vector_13, vector_13) - np.inner(vector_13, vector_12)) / (
                self.mag(np.cross(vector_13, vector_12)) ** 2)) * np.cross(vector_12, np.cross(vector_13, vector_12))
        k = np.cross(vector_13, vector_12)
        vector_1C = vector_C - vector_temp_list[0]
        value_s = self.mag(vector_1C)
        unit_vector_h = np.cross(vector_12, vector_23) / self.mag(np.cross(vector_12, vector_23))
        sign_h = unit_vector_h[2] / abs(unit_vector_h[2])
        H = vector_C + sign_h * value_h * unit_vector_h
        self.HookTrolleyLocation.append(H)

      elif len(self.HookTrolleyLiftingPoint_list[i]) == 2:  # HookTrolley의 권상포인트 개수가 2개 일 때
        vector_temp_list = []
        for j in self.HookTrolleyLiftingPoint_list[i]:
          X = j[1]
          Y = j[2]
          Z = j[3]
          data = [X, Y, Z]
          data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
          vector_temp_list.append(data)
        vector_K = 0.5 * (vector_temp_list[0] + vector_temp_list[1])
        vector_12 = vector_K - vector_temp_list[0]
        unit_vector_12 = (1 / self.mag(vector_12)) * vector_12
        value_h = math.sqrt(value_l ** 2 - self.mag(vector_12) ** 2)
        unit_vector_h = np.array(
          [-unit_vector_12[0] * unit_vector_12[2] / math.sqrt(unit_vector_12[0] ** 2 + unit_vector_12[1] ** 2),
           -unit_vector_12[1] * unit_vector_12[2] / math.sqrt(
             unit_vector_12[0] ** 2 + unit_vector_12[1] ** 2),
           math.sqrt(unit_vector_12[0] ** 2 + unit_vector_12[1] ** 2)])
        H = vector_K + value_h * unit_vector_h
        self.HookTrolleyLocation.append(H)
    temp_list = [list(array) for array in self.HookTrolleyLocation]

    print(f'## 계산된 권상 포인트 : {len(temp_list)}개 - {temp_list}')
    print('3단계 : ', self.HookTrolleyLocation)

  def TrolleyLocationCalc(self, debugPrint):
    self.HookTrolleyLocation = []
    for i in range(len(self.HookTrolleyLiftingPoint_list)):  # HookTrolley의-01에서 정렬한 리스트를 사용
      value_l = self.lineLength[i] * 1000 - 100
      if len(self.HookTrolleyLiftingPoint_list[i]) == 2:  # HookTrolley의 권상포인트 개수가 2개 일 때
        vector_temp_list = []
        for j in self.HookTrolleyLiftingPoint_list[i]:
          X = j[1]
          Y = j[2]
          Z = j[3]
          data = [X, Y, Z]
          data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
          vector_temp_list.append(data)

        vector_K = 0.5 * (vector_temp_list[0] + vector_temp_list[1])
        vector_K[2] = min(vector_temp_list[0][2], vector_temp_list[1][2]) + value_l
        self.HookTrolleyLocation.append(vector_K)

      elif len(self.HookTrolleyLiftingPoint_list[i]) == 4:  # HookTrolley의 권상포인트 개수가 4개 일 때
        vector_temp_list = []
        for j in self.HookTrolleyLiftingPoint_list[i]:
          X = j[1]
          Y = j[2]
          Z = j[3]
          data = [X, Y, Z]
          data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
          vector_temp_list.append(data)

        if self.shapeDetectorDict[f'SET{i + 1}'] == '4개점 사각형 형태':  # 4개점, 사각형 형태일때 계산 수행
          # 다시 정렬하기 전에, Y축(2번 인덱스) 값에 따라 아래변과 윗변의 노드를 구분해야 함
          # 먼저 Y축 값이 작은 순서대로 전체 리스트를 정렬
          sorted_by_y = sorted(self.HookTrolleyLiftingPoint_list[i], key=lambda x: x[2])

          # 아래변(가장 작은 Y값을 가진 두 노드)과 윗변(그 다음 작은 Y값을 가진 두 노드)을 구분
          lower_edge = sorted(sorted_by_y[:2], key=lambda x: x[1])  # Y축이 작은 두 노드를 X축 기준으로 정렬
          upper_edge = sorted(sorted_by_y[2:], key=lambda x: x[1])  # 나머지 두 노드를 X축 기준으로 정렬

          # 아래변과 윗변을 순서대로 합침
          sorted_correctly = lower_edge + upper_edge

          vector_temp_list = []
          for j in sorted_correctly:
            X = j[1]
            Y = j[2]
            Z = j[3]
            data = [X, Y, Z]
            data = np.array(data)  # 넘파이 Array로 변환 (Degree 계산을 위해)
            vector_temp_list.append(data)
          vector_12 = vector_temp_list[1] - vector_temp_list[0]
          vector_23 = vector_temp_list[2] - vector_temp_list[1]
          vector_C = 0.25 * (vector_temp_list[0] + vector_temp_list[1] + vector_temp_list[2] + vector_temp_list[3])

          vector_1C = vector_C - vector_temp_list[0]
          value_s = self.mag(vector_1C)
          value_h = math.sqrt(value_l ** 2 - value_s ** 2)
          unit_vector_h = np.cross(vector_12, vector_23) / self.mag(np.cross(vector_12, vector_23))
          H = vector_C + unit_vector_h[2] * value_h * unit_vector_h
          self.HookTrolleyLocation.append(H)
          # self.HookTrolleyLocation.append(H)

        elif '4개점 일직선 형태' in self.shapeDetectorDict[f'SET{i + 1}']:
          vector_K = (vector_temp_list[0] + vector_temp_list[1] + vector_temp_list[2] + vector_temp_list[3]) / 4
          vector_K[2] = min(vector_temp_list[0][2], vector_temp_list[1][2], vector_temp_list[2][2],
                            vector_temp_list[3][2]) + value_l
          self.HookTrolleyLocation.append(vector_K)

    temp_list = [list(array) for array in self.HookTrolleyLocation]
    if debugPrint:
      print('## 4단계 - 1 : 권상 포인트 계산')
      print(f'{len(temp_list)}개 - {temp_list}')
      print()

  def HooktoCOG(self):
    '''
    # HookTrolley-
    HookTrolley의 개수가 2개 일 때, HookTrolley 위치를 COG 중심으로 수정
    '''
    if len(self.HookTrolleyLocation) == 2:
      tolerence = 300
      point1 = self.HookTrolleyLocation[0]
      point2 = self.HookTrolleyLocation[1]
      x_diff = abs(point1[0] - point2[0])
      y_diff = abs(point1[1] - point2[1])
      if x_diff > y_diff:
        slope_list = [
          self.slope([self.HookTrolleyLocation[1][0], self.HookTrolleyLocation[1][1]],
                     [self.COG_dict['X'], self.COG_dict['Y']]),
          self.slope([self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[0][1]],
                     [self.COG_dict['X'], self.COG_dict['Y']])]
        intercept_list = [
          self.intercept([self.HookTrolleyLocation[1][0], self.HookTrolleyLocation[1][1]],
                         [self.COG_dict['X'], self.COG_dict['Y']]),
          self.intercept([self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[0][1]],
                         [self.COG_dict['X'], self.COG_dict['Y']])]
        R = (np.array(slope_list) * np.array(
          [self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[1][0]]) + np.array(
          intercept_list)).tolist()
        MAG = (np.array(R) - np.array([self.HookTrolleyLocation[0][1], self.HookTrolleyLocation[1][1]])).tolist()
        ABS_MAG = abs(
          (np.array(R) - np.array([self.HookTrolleyLocation[0][1], self.HookTrolleyLocation[1][1]]))).tolist()
      else:
        slope_list = [
          self.slope([self.HookTrolleyLocation[1][0], self.HookTrolleyLocation[1][1]],
                     [self.COG_dict['X'], self.COG_dict['Y']]),
          self.slope([self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[0][1]],
                     [self.COG_dict['X'], self.COG_dict['Y']])]
        intercept_list = [
          self.intercept([self.HookTrolleyLocation[1][0], self.HookTrolleyLocation[1][1]],
                         [self.COG_dict['X'], self.COG_dict['Y']]),
          self.intercept([self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[0][1]],
                         [self.COG_dict['X'], self.COG_dict['Y']])]
        R = (np.array(slope_list) * np.array(
          [self.HookTrolleyLocation[0][1], self.HookTrolleyLocation[1][1]]) + np.array(
          intercept_list)).tolist()
        MAG = (np.array(R) - np.array([self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[1][0]])).tolist()
        ABS_MAG = abs(
          (np.array(R) - np.array([self.HookTrolleyLocation[0][0], self.HookTrolleyLocation[1][0]]))).tolist()

      if any(item > 300 for item in ABS_MAG):
        pass
      else:
        if (ABS_MAG[0] < ABS_MAG[1]) and (x_diff > y_diff):
          self.HookTrolleyLocation[0][1] = R[0]
          print(f'## 권상 포인트 2개 경우에서 기존의 {self.HookTrolleyLocation[0][1]}를 COG 근처 {R[0]}으로 이동')
        if (ABS_MAG[0] < ABS_MAG[1]) and (x_diff < y_diff):
          self.HookTrolleyLocation[0][0] = R[0]
          print(f'## 권상 포인트 2개 경우에서 기존의 {self.HookTrolleyLocation[0][0]}를 COG 근처 {R[0]}으로 이동')
        if (ABS_MAG[0] > ABS_MAG[1]) and (x_diff > y_diff):
          self.HookTrolleyLocation[1][1] = R[1]
          print(f'## 권상 포인트 2개 경우에서 기존의 {self.HookTrolleyLocation[1][1]}를 COG 근처 {R[1]}으로 이동')
        if (ABS_MAG[0] > ABS_MAG[1]) and (x_diff < y_diff):
          self.HookTrolleyLocation[1][0] = R[1]
          print(f'## 권상 포인트 2개 경우에서 기존의 {self.HookTrolleyLocation[1][0]}를 COG 근처 {R[1]}으로 이동')

  def Overturn(self, debugPrint):
    '''
    # HookTrolley-
    계산된 TrolleyLocation_list가 이루는 사각형(4개점) 또는 삼각형(3개점) 내부에 COG가 존재하는지 확인
    '''

    self.TrolleyLocation_list = [list(array) for array in self.HookTrolleyLocation]

    # 필요 함수 정의
    def area_of_triangle(p1, p2, p3):
      """삼각형의 면적을 계산. 꼭지점이 주어지면 벡터의 외적을 사용해 면적을 계산."""
      return 0.5 * np.linalg.norm(np.cross(np.array(p2) - np.array(p1), np.array(p3) - np.array(p1)))

    def is_point_in_triangle(pt, tri):
      """점이 삼각형 내부에 있는지 판단. 삼각형의 꼭지점과 주어진 점으로 서브 삼각형을 만들어 면적을 비교."""
      p1, p2, p3 = tri
      main_area = area_of_triangle(p1, p2, p3)
      area1 = area_of_triangle(pt, p2, p3)
      area2 = area_of_triangle(p1, pt, p3)
      area3 = area_of_triangle(p1, p2, pt)
      return np.isclose(main_area, area1 + area2 + area3)

    def is_point_in_rectangle(pt, rect):
      """점이 사각형 내부에 있는지 판단. 사각형을 두 개의 삼각형으로 나누어 각각을 검사."""
      return is_point_in_triangle(pt, rect[:3]) or is_point_in_triangle(pt, [rect[0], rect[2], rect[3]])

    def is_point_on_line(pt, line):
      """점이 직선 위에 있는지 판단. 두 점 사이의 거리와 각 점에서 주어진 점까지의 거리의 합을 비교."""
      p1, p2 = line
      total_dist = np.linalg.norm(np.array(p1) - np.array(p2))
      dist1 = np.linalg.norm(np.array(pt) - np.array(p1))
      dist2 = np.linalg.norm(np.array(pt) - np.array(p2))
      return np.isclose(total_dist, dist1 + dist2)

    def extract_xy(point):
      """3D 좌표에서 X와 Y 좌표를 추출."""
      return [point[0], point[1]]

    TrolleyLocation_list_2D = [extract_xy(point) for point in self.TrolleyLocation_list]
    COG_point_2D = extract_xy([self.COG_dict['X'], self.COG_dict['Y'], self.COG_dict['Z']])

    # Overturn이 발생할 위험이 있다면 예외 처리 발생
    try:
      if len(TrolleyLocation_list_2D) == 2:
        result = is_point_on_line(COG_point_2D, TrolleyLocation_list_2D)
      elif len(TrolleyLocation_list_2D) == 3:
        result = is_point_in_triangle(COG_point_2D, TrolleyLocation_list_2D)
      elif len(TrolleyLocation_list_2D) == 4:
        result = is_point_in_rectangle(COG_point_2D, TrolleyLocation_list_2D)
      else:
        result = None
      if not result:
        raise ValueError("## 주어진 권상 위치에서 전도가 발생")


    except ValueError as e:
      print(str(e))
      # Fail인 경우에도 리포트에서 누락되지 않고 출력되도록 텍스트를 추가합니다.
      self.ModuleUnitResultText_list.append("2. 자세 안정성 평가 : Fail\n")
      self.ModuleUnitResultText_list.append(f"   사유: {str(e).replace('## ', '')}\n\n")
      return

    self.ModuleUnitResultText_list.append("2. 자세 안정성 평가 : OK\n\n")

    if debugPrint:
      print("## 5단계 : 자세 안전성 평가")
      print("해당 유닛 포인트에서 자세 안전성 평가 완료 : 문제 없음")
      print()

  def TrolleyLiftingPointSplitter(self, debugPrint):
    '''
    # HookTrolley-
    Trolley의 경우에 LiftingPoint를 900mm간격으로 별려준다.
    '''
    self.TrolleyLocation_list = [list(array) for array in self.HookTrolleyLocation]

    # Trolley LiftingPoint를 벌리는 방향을 결정하는 함수 선언
    def determine_direction():
      count_x = sum('방향: X' in value for value in self.shapeDetectorDict.values())
      count_y = sum('방향: Y' in value for value in self.shapeDetectorDict.values())
      if count_x >= count_y:
        direction = 'Y'
      else:
        direction = 'X'
      return direction

    direction = determine_direction()

    # 쪼개짐을 당한 HookTrolleyLocation을 담을 새로운 리스트 생성
    New_TrolleyLocation_list = []
    for i, s in enumerate(self.TrolleyLocation_list):
      if self.shapeDetectorDict[f'SET{i + 1}'] == '4개점 사각형 형태':
        spllited_HookTrolleyLocation_1 = copy.deepcopy(s)  # 원본꺼를 복사
        spllited_HookTrolleyLocation_2 = copy.deepcopy(s)
        if direction == 'X':
          spllited_HookTrolleyLocation_1[0] -= 450
          spllited_HookTrolleyLocation_2[0] += 450
        elif direction == 'Y':
          spllited_HookTrolleyLocation_1[1] -= 450
          spllited_HookTrolleyLocation_2[1] += 450
        New_TrolleyLocation_list.append(spllited_HookTrolleyLocation_1)
        New_TrolleyLocation_list.append(spllited_HookTrolleyLocation_2)
      elif '4개점 일직선 형태' in self.shapeDetectorDict[f'SET{i + 1}']:
        spllited_HookTrolleyLocation_1 = copy.deepcopy(s)  # 원본꺼를 복사
        spllited_HookTrolleyLocation_2 = copy.deepcopy(s)
        if '방향: X' in self.shapeDetectorDict[f'SET{i + 1}']:
          spllited_HookTrolleyLocation_1[0] -= 450
          spllited_HookTrolleyLocation_2[0] += 450
        else:
          spllited_HookTrolleyLocation_1[1] -= 450
          spllited_HookTrolleyLocation_2[1] += 450
        New_TrolleyLocation_list.append(spllited_HookTrolleyLocation_1)
        New_TrolleyLocation_list.append(spllited_HookTrolleyLocation_2)
      else:
        New_TrolleyLocation_list.append(s)

    # 기존의 self.HookTrolleyLocation를 New_TrolleyLocation_list로 바꿔치기
    self.HookTrolleyLocation = New_TrolleyLocation_list

    # 이제는 self.HookTrolleyLocation 위 과정에서 쪼개진 HookTrolleyLocation을 반영하여 SET를 쪼개준다.
    New_HookLiftingPoint_list = []
    for i, s in enumerate(self.HookTrolleyLiftingPoint_list):
      if '4개점 사각형 형태' in self.shapeDetectorDict[f'SET{i + 1}']:
        sorted_by_y = sorted(s, key=lambda x: x[2])

        # 아래변(가장 작은 Y값을 가진 두 노드)과 윗변(그 다음 작은 Y값을 가진 두 노드)을 구분
        lower_edge = sorted(sorted_by_y[:2], key=lambda x: x[1])  # Y축이 작은 두 노드를 X축 기준으로 정렬
        upper_edge = sorted(sorted_by_y[2:], key=lambda x: x[1])  # 나머지 두 노드를 X축 기준으로 정렬

        # 아래변과 윗변을 순서대로 합침
        s = lower_edge + upper_edge

        if direction == 'X':  # Direction이 X이면 1,3 / 2,4 순서로 HookliftingPoint에 추가가 되어야 한다.
          temp_list = [s[0], s[2]]
          New_HookLiftingPoint_list.append(temp_list)
          temp_list = [s[1], s[3]]
          New_HookLiftingPoint_list.append(temp_list)
        elif direction == 'Y':  # Direction이 Y이면 1,2 / 3,4 순서로 HookliftingPoint에 추가가 되어야 한다.
          temp_list = [s[0], s[1]]
          New_HookLiftingPoint_list.append(temp_list)
          temp_list = [s[2], s[3]]
          New_HookLiftingPoint_list.append(temp_list)
      elif '4개점 일직선 형태' in self.shapeDetectorDict[f'SET{i + 1}']:
        temp_list = [s[0], s[1]]
        New_HookLiftingPoint_list.append(temp_list)
        temp_list = [s[2], s[3]]
        New_HookLiftingPoint_list.append(temp_list)
      else:
        New_HookLiftingPoint_list.append(s)

    self.HookTrolleyLiftingPoint_list = New_HookLiftingPoint_list

    if debugPrint:
      print("## 4단계 - 2 : 골리앗 권상 포인트 재계산")
      for i in self.HookTrolleyLocation:
        print(i)
      print(f'=> Trolley 해석으로 권상 포인트 {len(self.HookTrolleyLiftingPoint_list)}개로 수정')
      print()

  def Pipe_SPCSetter(self, debugPrint):
    '''
    # HookTrolley-
    배관에서 RBE 중에 1번 경계 조건이 없는 경우 날라가므로, 배관에 1번이 하나라도 없으면 무게 중심에 가까운 Node에 SPC설정
    '''

    def create_node_to_elements_map(elements_dict, rigid_dict):
      """
      각 노드에 연결된 요소와 RBE 요소의 ID를 매핑.
      이 매핑은 요소들 사이의 연결 관계를 추적하는 데 사용.
      """
      node_to_elements_map = defaultdict(set)
      for elem_id, elem_info in elements_dict.items():
        if elem_info['PropertyID'] >= 100:
          for node_id in elem_info['NodesID']:
            node_to_elements_map[node_id].add(elem_id)

      for rbe_id, rbe_info in rigid_dict.items():
        ind_node = rbe_info['ind_node']
        dep_nodes = rbe_info['dep_nodes']

        # 'dep_nodes'가 2개 이상일 경우, 'ind_node'는 제외
        if len(dep_nodes) > 1:
          for dep_node in dep_nodes:
            node_to_elements_map[dep_node].add(rbe_id)
        # 'dep_nodes'가 1개만 있는 경우, 'ind_node'와 'dep_nodes' 모두 포함
        else:
          node_to_elements_map[ind_node].add(rbe_id)
          for dep_node in dep_nodes:
            node_to_elements_map[dep_node].add(rbe_id)

      return node_to_elements_map

    def find_connected_elements(start_elem_id, elements_dict, rigid_dict, node_to_elements):
      """
      시작 요소에서 연결된 모든 요소들과 RBE를 찾아서 반환합니다.
      이 함수는 깊이 우선 탐색(DFS)을 사용하여 연결된 요소들을 탐색합니다.
      """
      visited = set()  # 방문한 요소를 추적하기 위한 집합입니다. 중복 방문을 방지합니다.
      queue = deque([start_elem_id])  # 탐색을 시작할 요소의 ID를 포함하는 큐입니다.

      while queue:  # 큐에 요소가 남아있는 동안 계속 탐색을 진행합니다.
        current_elem = queue.popleft()  # 현재 탐색할 요소를 큐에서 제거합니다.
        if current_elem not in visited:  # 현재 요소가 아직 방문되지 않았다면
          visited.add(current_elem)  # 방문한 요소로 표시합니다.
          # 현재 요소가 elements_dict(일반 요소)에 있는지, 혹은 rigid_dict(RBE)에 있는지 확인합니다.
          if current_elem in elements_dict:
            nodes = elements_dict[current_elem]['NodesID']  # 일반 요소인 경우, 연결된 노드들의 ID를 가져옵니다.
          elif current_elem in rigid_dict:
            # RBE 요소인 경우, 독립 노드(ind_node)와 종속 노드(dep_nodes)의 ID를 모두 가져옵니다.
            nodes = [rigid_dict[current_elem]['ind_node']] + rigid_dict[current_elem]['dep_nodes']
          else:
            continue  # 현재 요소가 어느 쪽에도 속하지 않으면 다음 요소로 넘어갑니다.
          # 현재 요소와 연결된 모든 노드에 대해
          for node_id in nodes:
            # 해당 노드에 연결된 다른 요소들을 큐에 추가합니다. 이미 방문한 요소는 제외합니다.
            queue.extend(node_to_elements[node_id] - visited)
      return visited

    def group_elements(elements_dict, rigid_dict):
      """
      모든 요소와 RBE를 연결된 그룹으로 분류합니다.
      각 그룹은 연결된 요소들의 집합으로 구성됩니다.
      """
      node_to_elements = create_node_to_elements_map(elements_dict, rigid_dict)
      element_groups = []
      visited_elements = set()

      for elem_id in elements_dict:
        propertyID = elements_dict[elem_id]['PropertyID']
        if elem_id not in visited_elements and elements_dict[elem_id]['PropertyID'] >= 100 and \
                self.property_dict[propertyID]['Section'] == 'TUBE':
          connected_group = find_connected_elements(elem_id, elements_dict, rigid_dict, node_to_elements)
          if len(connected_group) > 1:  # 그룹의 크기가 1보다 큰 경우에만 추가
            element_groups.append(connected_group)
            visited_elements.update(connected_group)

      for rbe_id in rigid_dict:
        if rbe_id not in visited_elements:
          connected_group = find_connected_elements(rbe_id, elements_dict, rigid_dict, node_to_elements)
          if len(connected_group) > 1:  # 그룹의 크기가 1보다 큰 경우에만 추가
            element_groups.append(connected_group)
            visited_elements.update(connected_group)

      return element_groups

    def find_rigid_pipeTopipe(rigid_dict):
      rigid_nodes_dict = {}  # rigid를 구성하는 node 들울 ind, dep 무관하게 리스트로 묶어 딕셔너리에 모은다.
      for rbe_id in rigid_dict:
        if len(rigid_dict[rbe_id]['dep_nodes']) == 1:
          rigid_nodes_dict[rbe_id] = [rigid_dict[rbe_id]['ind_node'], rigid_dict[rbe_id]['dep_nodes'][0]]
        else:
          rigid_nodes_dict[rbe_id] = [*rigid_dict[rbe_id]['dep_nodes']]

      pipeTopipe_rigid_list = []  # 배관과 배관을 연결하는 rigid의 id를 추출하기 위한 리스트 생성
      for rigid in rigid_nodes_dict:
        isPipe_A = False
        isPipe_B = False
        rigid_nodes = rigid_nodes_dict[rigid]
        for ele in self.elements_dict:
          if rigid_nodes[0] in self.elements_dict[ele]['NodesID']:
            if self.elements_dict[ele]['PropertyID'] >= 100:
              isPipe_A = True
          if rigid_nodes[1] in self.elements_dict[ele]['NodesID']:
            if self.elements_dict[ele]['PropertyID'] >= 100:
              isPipe_B = True

        if isPipe_A and isPipe_B:  # rigid가 연결하는 양쪽 부재가 모두 배관이라면
          pipeTopipe_rigid_list.append(rigid)

      return rigid_nodes_dict, pipeTopipe_rigid_list

    # 두 벡터 사이의 각도를 계산하는 함수
    def angle_between_vectors(v1, v2):
      unit_v1 = v1 / np.linalg.norm(v1)
      unit_v2 = v2 / np.linalg.norm(v2)
      dot_product = np.dot(unit_v1, unit_v2)
      angle = np.arccos(dot_product)
      return np.degrees(angle)

    rigid_nodes_dict, find_rigid_pipeTopipe_list = find_rigid_pipeTopipe(self.rigid_dict)

    # self.rigid_dict 딕셔너리 중에서 배관과 배관을 연결하는 딕셔너리들만 모아주는 리스트 생성
    rigid_pipeTopipe_dict = {k: self.rigid_dict[k] for k in find_rigid_pipeTopipe_list if k in self.rigid_dict}

    self.grouped_pipes = group_elements(self.elements_dict, rigid_pipeTopipe_dict)  # 그룹핑 정상 진행 확인

    self.suppotTopipe_dict = {}  # 그룹별로 서포트에서 파이프로 이어지를 rigid를 모아두는 딕셔너리 생성
    for i, s in enumerate(self.grouped_pipes):  # 기존의 그룹화 된 그룹도 순회한다.
      temp_set = set()  # 그룹별 서포트-파이프 rigid를 모아둘 set 생성
      for rigid in rigid_nodes_dict:  # rigid_nodes_dict의 id를 순회
        if rigid not in find_rigid_pipeTopipe_list:  # 여기 rigid는 서포트와 배관을 연결하는 것들만
          for ele in s:  # 하나의 그룹에서 요소만 가지고 와서
            if ele not in self.rigid_dict.keys():  # 그룹에는 부재와 rigid가 같이 들어있기에 부재만 선택하는 것
              if rigid_nodes_dict[rigid][0] in self.elements_dict[ele]['NodesID'] or rigid_nodes_dict[rigid][1] in \
                      self.elements_dict[ele]['NodesID']:  # 서포트와 배관을 연결하는 rigid가 어느 그룹에 속해있는지 판단하기
                all_node_ids = [node_id for element in self.elements_dict.values() for node_id in element['NodesID']]
                if rigid_nodes_dict[rigid][0] in all_node_ids and rigid_nodes_dict[rigid][1] in all_node_ids:
                  temp_set.add(rigid)
      self.suppotTopipe_dict[f'group{i + 1}'] = temp_set  # 딕셔너리에 그룹별로 support-pipe를 연결하는 rigid id 의 모음

    self.SPC_AddNode_Pipe = []  # 그룹 배관에 SPC를 지정할 Node들을 모아두는 리스트
    for i, group in enumerate(self.suppotTopipe_dict):  # self.suppotTopipe_dict를 돌면서 dof 1이 존재하는지 유무 판단 절차 시작
      flag_is_DOF_1 = False  # DOF 1이 존재하는지 판단하는 flag
      for rigid in self.suppotTopipe_dict[group]:  # 딕셔너리에서 key에 속하는 set의 rigid를 하나씩 가지고 와서
        if '1' in self.rigid_dict[rigid]['DOF']:  # 그 rigid의 DOF에 '1'이 있다면
          flag_is_DOF_1 = True  # flag를 True로 변경
        # print(group, rigid, self.rigid_dict[rigid]['DOF'], flag_is_DOF_1)

      if not flag_is_DOF_1:  # DOF에 1이 없다면?
        temp_node_list = []
        for ele in self.grouped_pipes[i]:  # 기존에 생성한 그룹 별로 돌면서
          temp_node_list.extend(self.elements_dict[ele]['NodesID'])  # DOF가 1이 없는 그룹의 Element를 생성하는 node를 모은다.

        rigidNodes = set()
        for key, value in self.rigid_dict.items():
          rigidNodes.add(value['ind_node'])
          rigidNodes.update(value['dep_nodes'])

        # 정수를 정렬하여 리스트로 변환
        sorted_rigidNodes_list = sorted(rigidNodes)

        temp_node_list = [i for i in temp_node_list if i not in sorted_rigidNodes_list]

        closest_node, distance = self.find_closest_node(self.nodes_dict, temp_node_list,
                                                        self.COG_dict)  # COG가 가까운 node 찾기

        self.SPC_AddNode_Pipe.append(closest_node)

    if debugPrint:
      print('## 6단계 - 1 : Pipe와 RBE의 그룹들 중에서 1번 자유도 없다면 추가')
      print(f'경계조건 추가 Node: {self.SPC_AddNode_Pipe}')

  def COG_SPCSetter(self, debugPrint):
    '''
    Nastran 해석에서 날라가는 경우를 대비하여, 무게중심 근처의 H beam에 X,Y 방향 경계조건 설정
    '''
    # H 또는 L 섹션을 가진 Property ID를 찾아내는 과정
    HL_PropertyID_list = [prop_id for prop_id, prop_info in self.property_dict.items()
                          if prop_info['Section'] in ('H', 'L')]

    # 가장 큰 Dimension을 가진 상위 5개 Property ID 선정
    HL_PropertyID_list.sort(key=lambda prop_id: self.property_dict[prop_id]['Dim'][0], reverse=True)
    HL_PropertyID_list = HL_PropertyID_list[:5]

    # 모든 노드의 Z 좌표를 가져와 빈도수를 계산
    z_values = [node_info['Z'] for node_info in self.nodes_dict.values()]
    z_counter = Counter(z_values)

    # Z 좌표의 빈도수에 따라 SPC를 잡을 Z좌표를 찾는 과정
    for z, freq in z_counter.most_common():
      # 해당 Z 좌표에 있는 HL Property 노드들을 찾음
      HL_Nodes_list = [node_id for node_id in self.nodes_dict
                       if self.nodes_dict[node_id]['Z'] == z
                       and any(self.elements_dict[elem_id]['PropertyID'] in HL_PropertyID_list
                               for elem_id in self.elements_dict
                               if node_id in self.elements_dict[elem_id]['NodesID'])]

      # 노드 리스트가 비어 있지 않으면 가장 흔한 Z 좌표를 찾았으므로 반복 중단
      if HL_Nodes_list:
        most_common_z = z
        frequency = freq
        break
    else:
      # 모든 Z 높이에서 해당하는 노드가 없는 경우
      print('모든 Z 높이에서 HL Property에 해당하는 노드를 찾을 수 없습니다.')
      return

    # 가장 무게중심에 가까운 노드 찾기
    closest_node, distance = self.find_closest_node(self.nodes_dict, HL_Nodes_list, self.COG_dict)

    # SPC 설정을 위한 노드 추가
    self.SPC_AddNode_HL = [closest_node]

    if debugPrint:
      if debugPrint:
        print('## 6단계 - 2 : 유닛 무게중심 Node에 12 방향 경계조건 추가 ')
        print(f'경계조건 추가 Node: {self.SPC_AddNode_HL}')
        print()

  def BDF_Exporter(self):
    '''
    # HookTrolley-
    계산된 LiftingPoint로 새로운 Rod로 생성하여 연결하여 BDF 출력
    '''

    HookTrolleyLocation_list = [list(array) for array in self.HookTrolleyLocation]
    newNodes_list = []

    # 새로운 Node 정보 반영
    self.SPC_AddNode_ROD = []
    new_nodes = {}
    for i in HookTrolleyLocation_list:
      self.max_node_id += 1
      new_nodes[self.max_node_id] = [round(i[0], 1), round(i[1], 1), round(i[2], 1)]
      i.insert(0, self.max_node_id)
      self.SPC_AddNode_ROD.append(self.max_node_id)  # 새롭게 생성되는 ROD에도 경계조건 입력 (배관용이랑 분리, DOF가 6자유도 되어야 하기에)
    self.addNewNodes(new_nodes)  # model 객체에 Node 추가 완료

    # 새로운 Property 정보 반영
    self.max_property_id += 1
    new_property = [self.max_property_id, self.max_material_id, 314.1593, 15097.96]
    print('new_property : ', new_property)
    self.addNewProperty(new_property)  # model 객체에 Property 추가 완료

    # 새로운 Element 정보 반영
    self.new_elements = []  # 새롭게 추가되는 ROD 부재
    self.rod_group_list = []  # 해석 후에 Rod의 Axial Force 계산을 위해 엮이는 그룹의 리스트를 생성
    for i in range(len(HookTrolleyLocation_list)):
      rod_id_list = []
      HookTrolleyLocationNodeID = HookTrolleyLocation_list[i][0]
      newNodes_list.append(HookTrolleyLocationNodeID)
      for j in self.HookTrolleyLiftingPoint_list[i]:
        self.max_element_id += 1
        HookTrolleyLiftingPointID = j[0]
        temp_list = [self.max_element_id, self.max_property_id, HookTrolleyLocationNodeID, HookTrolleyLiftingPointID]
        rod_id_list.append(self.max_element_id)
        self.new_elements.append(temp_list)
      self.rod_group_list.append(rod_id_list)
    self.addNewElements(self.new_elements)

    self.model.spcs.clear()
    # 새로운 SPC 정보 반영
    for i in self.SPC_AddNode_Pipe:  # 그룹 pipe의 COG에 가장 가까운 Node에 SPC 추가
      new_spc = [1, i, '1', '0.0']
      self.addNewSPC(new_spc)

    for i in self.SPC_AddNode_ROD:  # 권상하게 되는 ROD의 고정 점에 SPC 추가
      new_spc = [1, i, '123456', '0.0']
      self.addNewSPC(new_spc)

    # GRAV의 ID가 2가 아니면 2로 수정해주는 절차
    old_gravID = None
    new_gravID = 2
    for load_id, loads in self.model.loads.items():
      for load in loads:
        if load.type == 'GRAV':
          if load.sid != 2:
            old_gravID = load.sid

    if old_gravID:
      self.model.loads[new_gravID] = self.model.loads[old_gravID]
      del self.model.loads[old_gravID]
      for load in self.model.loads[new_gravID]:
        load.sid = 2

    # SOL 101 설정
    self.model.sol = 101

    new_settings = [
      'DISPLACEMENT = ALL',
      'SPCFORCES = ALL',
      'STRESS = ALL',
      'ELFORCE = ALL',
      'SUBCASE 1',
      'ANALYSIS = STATICS',
      'LABEL = LC1',
      'LOAD = 2',
      'SPC = 1',
      'BEGIN BULK',
    ]
    new_case_control_deck = CaseControlDeck(new_settings, self.model.log)
    self.model.case_control_deck = new_case_control_deck
    self.model.add_param('POST', -1)
    self.model.add_param('MAXRATIO', 1.0e+15)

    # # SUBCASE 수정
    for subcaseID in self.model.subcases:  # SUBCASE를 모두 순회
      subcase = self.model.subcases[subcaseID]
      if subcase.params.get('LOAD'):
        subcase.params['LOAD'][0] = 2

      if subcaseID == 1:
        subcase.add('SPC', 1, options=[], param_type='STRESS-type')

    for i in self.SPC_AddNode_HL:  # HL 구조의 COG에 가장 가까운 Node에 SPC 추가

      new_spc = [1, i, '12', '0.0']  # SPC의 id는 1로 통일
      # new_spc = [1, i, self.SPC_direction, '0.0']  # SPC의 id는 1로 통일
      self.addNewSPC(new_spc)

    self.exportBDF(self.new_bdf)

    # ==========================================================================
    # [추가됨] 출력된 파일을 다시 읽어서 RBE2 자유도를 123456으로 강제 수정
    # ==========================================================================
    try:
      modified_lines = []
      rbe2_count = 0

      # 파일 읽기
      with open(self.new_bdf, 'r', encoding='utf-8') as f:
        lines = f.readlines()

      for line in lines:
        # RBE2로 시작하는 라인인지 확인 (Fixed Format 기준)
        if line.startswith('RBE2') and '$' not in line:
          # CM(자유도) 필드는 24번째~32번째 인덱스 (Nastran Fixed Format: 8칸씩)
          # Field 1: RBE2 (0-8)
          # Field 2: EID (8-16)
          # Field 3: GN (16-24)
          # Field 4: CM (24-32) <--- 여기를 수정해야 함

          if len(line) >= 32:
            # 기존 라인의 앞부분(0~24) + 수정된 CM('  123456') + 뒷부분(32~)
            # :>8 은 8칸 공간에 오른쪽 정렬을 의미함
            new_line = line[:24] + f"{'123456':>8}" + line[32:]
            modified_lines.append(new_line)
            rbe2_count += 1
          else:
            modified_lines.append(line)
        else:
          modified_lines.append(line)

      # 수정된 내용으로 덮어쓰기
      with open(self.new_bdf, 'w', encoding='utf-8') as f:
        f.writelines(modified_lines)

      if self.debugPrint:
        print(f"## [Post-Process] 생성된 BDF에서 {rbe2_count}개의 RBE2 요소를 자유도 123456으로 수정함.")

    except Exception as e:
      print(f"Warning: BDF 파일 후처리(RBE2 수정) 중 오류 발생: {e}")

  '''
      /// <summary>
      /// BDF 파일의 형식을 안전하게 수정합니다.
      /// GRID 카드의 공백 패딩 문제를 해결하고, PBEAML 카드의 '+' 기호 파싱 등 데이터 변환 예외를 방지합니다.
      /// </summary>
      '''

  def BDF_InfogetEdit(self, debugPrint):
    NewBDF = []
    PBEAML_tag = False
    isGrav = False

    with open(self.new_bdf, 'r', encoding='utf8') as f:
      lines = f.readlines()

    for lineidx in range(len(lines)):
      line = lines[lineidx]
      if not PBEAML_tag:
        # 8자리씩 문자열 분할
        line_split = [line[i:i + 8] for i in range(0, 64, 8)]
        card_name = line_split[0].strip() if len(line_split) > 0 else ""

        if 'PROD' in line and '$$' not in line:
          NewBDF.append(line)

        # [수정] 조건문 논리 오류 해결: in 대신 card_name 직접 비교
        elif card_name == 'GRID' and '$' not in line:
          try:
            GRID = card_name
            NodeID = int(line_split[1].strip())
            X = float(line_split[3].strip())
            Y = float(line_split[4].strip())
            Z = float(line_split[5].strip())
            BDFtext = f'{GRID:<8}{NodeID:>8}{"":>8}{X:>8.1f}{Y:>8.1f}{Z:>8.1f}\n'
            NewBDF.append(BDFtext)
          except ValueError:
            NewBDF.append(line)  # 파싱 실패 시 원본 유지

        elif 'PBEAML' in line and '$$' not in line:
          PBEAML_tag = True
          NewBDF.append(line)
        elif 'GRAV' in line and '$' not in line:
          isGrav = True
          NewBDF.append(line)
        else:
          NewBDF.append(line)

      elif PBEAML_tag:
        line_split = line.split()
        BDFtext = f'{"":<8}'
        for item in line_split:
          item_stripped = item.strip()
          # [수정] 연속 마커 '+' 등은 float 변환 제외
          if item_stripped == '+':
            BDFtext += f'{item_stripped:<8}'
          else:
            try:
              BDFtext += f'{float(item_stripped):>8}'
            except ValueError:
              BDFtext += f'{item_stripped:>8}'
        BDFtext += '\n'
        NewBDF.append(BDFtext)
        PBEAML_tag = False

    if not isGrav:
      # float() 변환 시 자릿수 밀림을 방지하기 위해 소수점 1자리 포맷팅 명시
      Gravtext = f'{"GRAV":<8}{"2":>8}{"":>8}{"9800.0":>8}{"0.0":>8}{"0.0":>8}{float(self.Safety_Factor) * -1:>8.1f}\n'
      NewBDF.insert(-1, Gravtext)

    # 원본 파일을 덮어쓰기 전에 메모리에서 완벽히 조합 후 기록하여 0 Byte 증발 방지
    with open(self.new_bdf, 'w', encoding='utf8') as f:
      f.writelines(NewBDF)

  def Analysis(self, debugPrint):
    analysis_folder = os.path.dirname(self.new_bdf)
    os.chdir(analysis_folder)
    # [수정] 명령어 배열 생성 및 bat=no 속성 추가 (MSC Nastran의 경우 프로세스 동기화에 필수)
    command = ['nastran', self.new_bdf, 'bat=no']

    os.chdir(os.path.dirname(self.new_bdf))
    # [수정] Popen() 대신 subprocess.run()을 사용하여 서브프로세스 종료를 보장
    import subprocess
    subprocess.run(command, cwd=analysis_folder, check=False)

    self.op2_path = self.new_bdf.replace('.bdf', '.op2')

    if debugPrint:
      print('## 8단계 : Nastran 해석 실행')

    if os.path.exists(self.op2_path):
      if debugPrint:
        print("Module Unit 해석 완료")
    else:
      if debugPrint:
        print("Module Unit 해석 오류 발생")
    print()

  @staticmethod
  def ExtractFatalErrors(f06_filepath, context_lines=10):
    """
    <summary>
    .f06 파일에서 'FATAL' 문자열을 찾아 전후 문맥을 파싱하여 리스트로 반환합니다.
    </summary>
    <param name="f06_filepath">파싱할 f06 파일 경로</param>
    <param name="context_lines">에러 발생 위치 기준 전후로 추출할 줄 수</param>
    <returns>파싱된 에러 메시지 문자열 리스트</returns>
    """
    if not os.path.exists(f06_filepath):
      return ["f06 파일이 존재하지 않아 에러 내역을 파싱할 수 없습니다.\n"]

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

  def AssessmentResults(self):
    """
    <summary>
    Nastran 해석 결과를 분석하고 평가 보고서를 생성합니다.BDF_InfogetEdit

    (요청된 after.txt 포맷에 맞춰 ton 환산 및 최상단 종합 결과를 추가했습니다.)
    </summary>
    """
    op2_file = os.path.join(os.getcwd(), self.op2_path)
    f06_file = self.new_bdf.replace('.bdf', '.f06')
    self.ResultTxt = self.new_bdf.replace('.bdf', '.txt')

    # 1. 해석 성공: OP2 파일이 존재하는 경우
    if os.path.exists(op2_file):
      self.op2Results = hmNastranOP2_Analyzer(op2_file)
      self.op2Results.resultsSetting()

      displacement_sorted = self.op2Results.disp_results[0].sort_values(by='disp', ascending=False).head(1)
      stress_sorted = self.op2Results.stress1D_results[0].sort_values(by='Stress', ascending=False).head(1)
      ELForceROD_df = self.op2Results.ELForceROD_results[0]

      isErrorROD = False
      if (ELForceROD_df['Axial_Force'] < 0).any():
        isErrorROD = True
        print('ROD의 Axial이 음수가 존재하므로 권상 위치를 잘못 설정하였음')

      # Trolley의 경우 그룹의 Axial force 평균값 적용
      if self.lifting_method == 1:
        for group in self.rod_group_list:
          avg_axial_force = ELForceROD_df[ELForceROD_df['Element'].isin(group)]['Axial_Force'].mean()
          ELForceROD_df.loc[ELForceROD_df['Element'].isin(group), 'Axial_Force'] = avg_axial_force

      # 변위 및 응력 평가 지표 산출
      disp = round(float(displacement_sorted['disp'].iloc[0]), 1)
      Element = round(int(stress_sorted['Element'].iloc[0]), 1)
      Stress = round(float(stress_sorted['Stress'].iloc[0]), 1)
      SafetyFactor = round((220.0 / Stress), 1)

      # Pass 대신 명시적인 OK 사용 (after.txt 요구사항)
      AssessmentResult = "OK" if SafetyFactor > 1 else "Fail"

      self.ModuleUnitResultText_list.append(f"2. 구조 안정성 평가 : {AssessmentResult}\n")
      self.ModuleUnitResultText_list.append(f"   1) 최대 변형 : {disp}mm \n")
      self.ModuleUnitResultText_list.append(f"   2) 응력 평가 (항복응력 : 275MPa 허용응력 : 항복응력 x 0.8 = 220MPa) \n")
      self.ModuleUnitResultText_list.append(f"     ElementID:{' ':>8}{Element:<10}\n")
      self.ModuleUnitResultText_list.append(f"     Stress:{' ':>11}{Stress}MPa\n")
      self.ModuleUnitResultText_list.append(f"     SafetyFactor:{' ':>5}{SafetyFactor:<10}\n\n")

      # wire 고유 번호를 추출
      pattern = r'^\$\$([^\s]+)\s+(\d+)\s+(\d+)'
      wire_results = []
      with open(self.filename, 'r', encoding='utf-8') as f:
        for line in f:
          match = re.match(pattern, line.strip())
          if match:
            key = match.group(1)
            wire_results.append(key)

      self.ModuleUnitResultText_list.append(f"3. 장력 평가 (안전하중 : 6.2 ton / 60,760 N) \n")
      for idx, row in ELForceROD_df.iterrows():
        element_id = int(row['Element'])
        axial_force = round(float(row['Axial_Force']), 2)

        # N(뉴턴)을 ton으로 환산 (중력가속도 9800.0 기준)
        ton_force = round(axial_force / 9800.0, 2)
        force_str = f"{ton_force:.2f}ton / {axial_force}"

        wire_assessment = " 국부 변형 방지 지그 불필요" if axial_force < 60760 else " 국부 변형 방지 지그 필요"

        # 인덱스 오류 방지 (안전 장치)
        wire_key = wire_results[idx] if idx < len(wire_results) else f"Wire-{idx}"
        self.ModuleUnitResultText_list.append(
          f"{wire_key:<10}{element_id:<10}{force_str:<25}{wire_assessment:<20}\n"
        )

      print('## 9단계 : Module Unit 해석 완료  ')

    # 2. 해석 실패: OP2 파일이 없는 경우 (FATAL 처리)
    else:
      print("## 에러: op2 파일이 생성되지 않았습니다. f06 파일에서 FATAL 내역을 파싱합니다.")
      self.ModuleUnitResultText_list.append("NASTRAN 해석 실패 (FATAL ERROR 발생)\n")

      fatal_messages = self.ExtractFatalErrors(f06_file, context_lines=10)
      self.ModuleUnitResultText_list.extend(fatal_messages)

    # ==========================================
    # 3. 최상단 종합 결과 판별 로직 및 파일 저장
    # ==========================================
    overall_status = "OK"
    for text in self.ModuleUnitResultText_list:
      if "Fail" in text or "FATAL" in text:
        overall_status = "Fail"
        break

    # 최상단(Index 0)에 종합 결과 삽입
    self.ModuleUnitResultText_list.insert(0, f"*** 결과 : {overall_status} ***\n\n")

    # 결과 텍스트 파일 저장
    with open(self.ResultTxt, 'w', encoding='utf8') as f:
      for text in self.ModuleUnitResultText_list:
        f.write(text)


# 인포겟 프로그램에서 출력된 bdf 파일에서 해석에 필요한 요소들을 추출해내는 메써드
def InforgetMode(inforgetBDF):
  ModulePoint_idx_list = []
  lifting_method = None
  with open(inforgetBDF, 'r', encoding='utf8') as f:
    lines = f.readlines()
    for line_idx in range(len(lines)):
      if '$$Hydro' in lines[line_idx] or '$$Goliat' in lines[line_idx]:
        if '$$Hydro' in lines[line_idx]:
          lifting_method = 0
        elif '$$Goliat' in lines[line_idx]:
          lifting_method = 1
        ModulePoint_info_idx_start = line_idx + 1
        ModulePoint_idx_list.append(ModulePoint_info_idx_start)

      if '$$------------------------------------------------------------------------------$' in lines[line_idx]:
        ModulePoint_info_idx_end = line_idx
        ModulePoint_idx_list.append(ModulePoint_info_idx_end)
        break

  ModuleInfo_text = lines[ModulePoint_idx_list[0]: ModulePoint_idx_list[1]]

  ModuleInfo_dict = {}
  lineLength_list = []
  for line in ModuleInfo_text:
    clean_item = line.replace('$$', '').strip()
    parts = clean_item.split()
    category = int(parts[0].split('-')[0])  # '1-1'에서 '1' 추출
    data_value = (int(parts[1]), int(parts[2]))  # 두 번째와 세 번째 인덱스 값 (정수 변환)

    # 카테고리에 따라 그룹화하여 첫 번째 인덱스 값만 저장
    if category not in ModuleInfo_dict:
      ModuleInfo_dict[category] = [data_value[0]]
      lineLength_list.append(data_value[1])
    else:
      ModuleInfo_dict[category].append(data_value[0])

  ModuleInfo_list = list(ModuleInfo_dict.values())

  return inforgetBDF, ModuleInfo_list, lineLength_list, lifting_method


# 실행 코드
def main():
  try:
    # 입력 인자: 원본 BDF 경로, 출력 BDF 경로
    input_bdf = sys.argv[1]  # 예: 'input.bdf'
    export_bdf = sys.argv[2]  # 예: 'output.bdf'

    with open("log.txt", "w") as f:
      f.write(f"input: {input_bdf}\n")
      f.write(f"output: {export_bdf}\n")
      f.write(f"cwd: {os.getcwd()}\n")

    # 사용자 정의 전처리 함수 호출
    bdf, HookTrolley_list, lineLength, lifting_method = InforgetMode(input_bdf)

    with open("log.txt", "a") as f:
      f.write(f"변경 input: {bdf}\n")
      f.write(f"변경 output: {export_bdf}\n")
      f.write(f"변경 cwd: {os.getcwd()}\n")

    try:
      ht = HookTrolley_GU(bdf, export_bdf, HookTrolley_list, lineLength,
                       Safety_Factor=-1.2, lifting_method=lifting_method,
                       analysis=True, debugPrint=True)
      ht.HookTrolleyRun()
    except Exception as e:
      with open("log.txt", "a") as f:
        f.write(f"[HookTrolley 생성 실패] {str(e)}\n")
      raise

    print("HookTrolley 실행 완료")
  except Exception as e:
    print("실행 중 오류 발생:", str(e))


if __name__ == "__main__":
  main()