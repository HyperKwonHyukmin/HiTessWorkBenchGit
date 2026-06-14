import math
import numpy as np

class CalcFunc:

  def degree(self, a, b):
    '''각도 계산'''
    return (math.acos(np.inner(a, b) / (self.mag(a) * self.mag(b)))) * 180 / math.pi

  def mag(self, a):
    '''벡터 크기 계산'''
    return math.sqrt(math.pow(a[0], 2) + math.pow(a[1], 2) + math.pow(a[2], 2))

  def length(self, a, b):
    '''벡터 길이 계산'''
    return math.sqrt(math.pow(b[0] - a[0], 2) + math.pow(b[1] - a[1], 2) + math.pow(b[2] - a[2], 2))

  def mag(self, a):
    '''벡터 크기 계산'''
    return math.sqrt(math.pow(a[0], 2) + math.pow(a[1], 2) + math.pow(a[2], 2))

  def slope(self,a, b):
    '''기울기 계산'''
    return (b[1] - a[1]) / (b[0] - a[0])

  def intercept(self, a, b):
    '''절편 계산'''
    return b[1] - self.slope(a, b) * b[0]

  def slope1(self, a, b):
    '''기울기 계산(Trolley)'''
    return (b[0] - a[0]) / (b[1] - a[1])

  def intercept1(self, a, b):
    '''절편 계산(Trolley)'''
    return b[0] - self.slope1(a, b) * b[1]

  # 각 노드까지의 거리를 계산하고, 가장 가까운 노드를 찾는 함수
  def find_closest_node(self, nodes_dict, HL_Nodes_list, target_location):
    closest_node = None
    min_distance = float('inf')
    for i in HL_Nodes_list:
      node_id = i
      # for node_id, node_info in nodes_dict.items():
      # 각 노드와 주어진 위치 사이의 유클리드 거리 계산
      distance = np.sqrt((nodes_dict[i]['X'] - target_location['X']) ** 2 +
                         (nodes_dict[i]['Y'] - target_location['Y']) ** 2 +
                         (nodes_dict[i]['Z'] - target_location['Z']) ** 2)
      # 가장 짧은 거리 업데이트
      if distance < min_distance:
        min_distance = distance
        closest_node = node_id
    return closest_node, min_distance

