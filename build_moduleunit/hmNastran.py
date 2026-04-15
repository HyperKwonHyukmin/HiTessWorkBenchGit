from pyNastran.bdf.bdf import BDF, CROD, GRID, PROD
from pyNastran.op2.op2 import OP2
import numpy as np
import logging
import copy
import math
import pandas as pd


pd.set_option('display.max_columns', None)
pd.set_option('display.max_rows', None)

# PyNastran 로거의 레벨을 INFO 이상으로 설정하여 DEBUG 메시지를 숨깁니다.
logging.getLogger('pyNastran').setLevel(logging.INFO)


class hmNastranBDF_Importer:
  def __init__(self, bdf_file):
    self.bdf_file = bdf_file
    self.model = BDF()
    self.model.read_bdf(bdf_file, xref=True)
    # self.remove_duplicate_nodes()


  def remove_duplicate_nodes(self):
    '''
    절대위치는 동일하나 ID는 다른 중복 Node를 제거
    '''
    # 각 위치에 대한 노드 ID를 저장하는 딕셔너리
    position_to_nodes = {}

    for nid, node in self.model.nodes.items():
      position = tuple(node.get_position())
      position_to_nodes.setdefault(position, []).append(nid)

    for nodes in position_to_nodes.values():
      if len(nodes) > 1:
        min_nid = min(nodes)
        for nid in nodes:
          if nid != min_nid:
            del self.model.nodes[nid]


  def makeDictNodes(self):
    self.nodes_dict = {}
    for node_id, node in self.model.nodes.items():
      x, y, z = node.get_position()
      self.nodes_dict[node_id] = {"X": x, "Y": y, "Z": z}


  def makeDictElements(self):
    self.elements_dict = {}
    for elem_id, elem in self.model.elements.items():
      node_ids = elem.node_ids
      property_id = elem.pid
      self.elements_dict[elem_id] = {"NodesID": node_ids, "PropertyID": property_id}


  def makeDictMaterial(self):
    self.material_dict = {}
    for mat_id, material in self.model.materials.items():
      if material.type == 'MAT1':
        e = material.E()  # 탄성 계수
        g = material.G()  # 전단 계수
        nu = material.nu  # 포아송 비
        rho = material.rho  # 밀도
        self.material_dict[mat_id] = {"E": e, "G": g, "nu": nu, "rho": rho}


  def makeDictProperty(self):
    self.property_dict = {}
    for prop_id, prop in self.model.properties.items():
      if prop.type == 'PBEAML':
        section = prop.beam_type  # 섹션 유형
        dimensions = prop.dim  # 섹션 치수
        material = prop.mid
        # 추가할 필드 예시
        so_n = getattr(prop, 'so_n', 'YES')  # 기본값으로 'YES' 설정
        self.property_dict[prop_id] = {"Section": section, "Dim": dimensions[0].tolist(), "MaterialID": material,
                                       "so_n": so_n}


  def makeDictComn(self):
    self.comn_dict = {}
    for mass_id, mass in self.model.masses.items():
      if mass.type == 'CONM2':
        node_id = mass.nid  # 연결된 노드 ID
        mass_value = mass.Mass()  # 질량 값
        self.comn_dict[mass_id] = {"NodesID": node_id, "Mass": mass_value}


  def makeDictRigid(self):
    self.rigid_dict = {}
    for rigid_id, rigid in self.model.rigid_elements.items():
      if rigid.type == 'RBE2':
        independent_node = rigid.Gn()  # 독립 노드
        dependent_nodes = rigid.Gmi  # 종속 노드
        dof = rigid.cm  # 연결된 자유도
        self.rigid_dict[rigid_id] = {"ind_node": independent_node, "dep_nodes": dependent_nodes, "DOF": dof}


  def makeDictCOG(self):
    beamINFO_dict = copy.deepcopy(self.elements_dict)
    Total_mass = 0
    sum_mass_x = 0
    sum_mass_y = 0
    sum_mass_z = 0
    for ele in beamINFO_dict:
      Node1_Location = self.nodes_dict[beamINFO_dict[ele]['NodesID'][0]]
      Node2_Location = self.nodes_dict[beamINFO_dict[ele]['NodesID'][1]]
      Distance = math.sqrt(
        (Node2_Location['X'] - Node1_Location['X']) ** 2 + (Node2_Location['Y'] - Node1_Location['Y']) ** 2 + (
            Node2_Location['Z'] - Node1_Location['Z']) ** 2)
      beamINFO_dict[ele]['Distance'] = Distance

      PropertyID = beamINFO_dict[ele]['PropertyID']
      Type = self.property_dict[PropertyID]['Section']
      beamINFO_dict[ele]['Type'] = Type

      Dim = self.property_dict[PropertyID]['Dim']
      beamINFO_dict[ele]['Dim'] = Dim

      MaterialID = self.property_dict[PropertyID]['MaterialID']
      Density = self.material_dict[MaterialID]['rho']
      beamINFO_dict[ele]['Density'] = Density  # 밀도는 mild steel로 통일

      if Type == 'ROD':
        Area = round(math.pi * Dim[0] ** 2, 1)
      elif Type == 'BAR':
        Area = round(Dim[0] * Dim[1])
      elif Type == 'TUBE':
        Area = round(((math.pi * Dim[0] ** 2) - (math.pi * Dim[1] ** 2)), 1)
      elif Type == 'L':
        Area = round((Dim[0] * Dim[2] + Dim[1] * Dim[3]) - (Dim[2] * Dim[3]), 1)
      elif Type == 'H':
        Area = round((Dim[0] * Dim[3]) + (Dim[1] * Dim[2]), 1)

      beamINFO_dict[ele]['Area'] = Area

      Mass = Density * Area * Distance
      beamINFO_dict[ele]['Mass'] = Mass
      Total_mass += Mass

      xyz = [0.5 * (Node2_Location['X'] + Node1_Location['X']), 0.5 * (Node2_Location['Y'] + Node1_Location['Y']),
             0.5 * (Node2_Location['Z'] + Node1_Location['Z'])]
      beamINFO_dict[ele]['xyz'] = xyz

      sum_mass_x += (Mass * xyz[0])
      sum_mass_y += (Mass * xyz[1])
      sum_mass_z += (Mass * xyz[2])

    # 집중질량 계산
    self.conmINFO_dict = copy.deepcopy(self.comn_dict)
    for conm in self.conmINFO_dict:
      conmNode = self.nodes_dict[self.conmINFO_dict[conm]['NodesID']]
      xyz = [conmNode['X'], conmNode['Y'], conmNode['Z']]
      self.conmINFO_dict[conm]['xyz'] = xyz
      Total_mass += self.conmINFO_dict[conm]['Mass']

      sum_mass_x += (self.conmINFO_dict[conm]['Mass'] * xyz[0])
      sum_mass_y += (self.conmINFO_dict[conm]['Mass'] * xyz[1])
      sum_mass_z += (self.conmINFO_dict[conm]['Mass'] * xyz[2])

    cog_x = sum_mass_x / Total_mass
    cog_y = sum_mass_y / Total_mass
    cog_z = sum_mass_z / Total_mass

    self.COG_dict = {'X': cog_x, 'Y': cog_y, 'Z': cog_z}


  def run(self):
    self.makeDictNodes()
    self.makeDictElements()
    self.makeDictMaterial()
    self.makeDictProperty()
    self.makeDictComn()
    self.makeDictRigid()
    self.makeDictCOG()


class hmNastranBDF_Exporter:
  def __init__(self, bdf_file):
    self.bdf_file = bdf_file
    self.model = BDF()
    self.model.read_bdf(bdf_file, xref=True)

    # 새로운 Node 생성을 위한 최대 NodeID 정보
    existing_node_ids = set(self.model.nodes.keys())
    self.max_node_id = max(existing_node_ids) if existing_node_ids else 0

    # 새로운 Element 생성을 위한 최대 ElementID 정보
    existing_element_ids = set(self.model.elements.keys())
    # RBE2 엘리먼트 ID 추출 (RBE2 엘리먼트가 있다고 가정)
    existing_rbe2_ids = set(self.model.rigid_elements.keys())
    # 일반 엘리먼트 ID와 RBE2 엘리먼트 ID를 병합
    combined_element_ids = existing_element_ids.union(existing_rbe2_ids)
    # 병합된 ID 세트에서 최대값 계산
    self.max_element_id = max(combined_element_ids) if combined_element_ids else 0

    # 새로운 Property 생성을 위한 최대 PropertyID 정보
    existing_property_ids = set(self.model.properties.keys())
    self.max_property_id = max(existing_property_ids) if existing_property_ids else 0

    # 새로운 Property 생성을 위한 최대 PropertyID 정보
    existing_material_ids = set(self.model.materials.keys())
    self.max_material_id = max(existing_material_ids) if existing_material_ids else 0

    # 새로운 SPC 생성을 위한 최대 SPCID 정보
    existing_spc_ids = set(self.model.spcs.keys())
    self.max_spc_id = max(existing_spc_ids) if existing_spc_ids else 0


  def addNewNodes(self, new_nodes):
    '''
    new_nodes = {
        11179: [x, y, z],  # 실제 좌표로 교체 필요
        11180: [x, y, z],
        # ... 나머지 노드

    } 이런 형태의 new_nodes가 존재해야함
    '''
    # 새로운 노드 추가
    for nid, xyz in new_nodes.items():
      if nid not in self.model.nodes:
        self.model.add_grid(nid, xyz)


  def addNewElements(self, new_elements):
    '''
    # 새로운 CROD 요소와 관련 노드 데이터 정의
    new_elements = [
        (11547, 141, 11179, 11173),
        (11548, 141, 11179, 11174),
        # ... 나머지 CROD 요소
    ]
     이런 형태의 new_elements가 존재해야함
    '''
    # 새로운 CROD 요소 추가
    for eid, pid, n1, n2 in new_elements:
      if eid not in self.model.elements:
        self.model.add_crod(eid, pid, [n1, n2])


  def addNewRBE2(self, new_rbe2s):
    '''
    새로운 RBE2 요소 추가
    new_rbe2s 형태:
        [(rbe2_id, independent_node_id, dependent_nodes, dofs), ...]
    '''
    rbe2_id, independent_node_id, dependent_nodes, dofs = new_rbe2s
    self.model.add_rbe2(rbe2_id, independent_node_id, dependent_nodes, dofs)


  def addNewProperty(self, new_property):
    # PROD 요소의 ID, 재질 ID, A, J 값을 설정
    eid, pid, A, J = new_property
    if eid not in self.model.properties:
      self.model.add_prod(eid, pid, A, J)


  def addNewSPC(self, new_spcs):
    '''
    새로운 SPC 추가
    new_spcs 형태:
        [(spc_id, node_id, dofs, value), ...]
    '''
    spc_id, node_id, dofs, value = new_spcs
    self.model.add_spc(spc_id, node_id, dofs, float(value))


  def exportBDF(self, bdfName):
    self.model.write_bdf(bdfName)


class hmNastranOP2_Analyzer:
  def __init__(self, op2_file):
    self.op2_file = op2_file
    self.op2 = OP2()
    self.op2.read_op2(self.op2_file, build_dataframe=False)
    self.caseCount = 0  # 해석 케이스 개수 파악


  def resultsSetting(self):
    # f06에서 다음 결과들이 출력되어 있는지 유무 (기본 값으로 False)
    self.is_disp = False
    self.is_SPC = False
    self.is_ELForce = False
    self.is_stress1D = False
    self.is_ELForceROD = False

    self.disp_results = []
    self.SPC_results = []
    self.ELForce_results = []
    self.ELForceROD_results = []
    self.stress1D_results = []

    ## 변위 결과 정리하기
    if hasattr(self.op2, 'displacements'):
      self.is_disp = True
      self.caseCount = len(self.op2.displacements)
      for subcase, disp_array in self.op2.displacements.items():
        temp_list = []
        for index, (node_id, displacement) in enumerate(zip(disp_array.node_gridtype[:, 0], disp_array.data[0])):
          displacement = np.insert(displacement, 0, int(node_id))
          temp_list.append(displacement)
        df_disp = pd.DataFrame(temp_list, columns=['Node', 'T1', 'T2', 'T3', 'R1', 'R2', 'R3'])
        df_disp['Node'] = df_disp['Node'].astype(int)
        df_disp['disp'] = np.sqrt(df_disp['T1'] ** 2 + df_disp['T2'] ** 2 + df_disp['T3'] ** 2).round(2)
        self.disp_results.append(df_disp)

    ## SPC Force 결과 정리하기
    if hasattr(self.op2, 'spc_forces'):
      self.is_SPC = True
      self.caseCount = len(self.op2.spc_forces)
      for subcase, spc_force_array in self.op2.spc_forces.items():
        temp_list = []
        for index, (node_id, spc_force) in enumerate(zip(spc_force_array.node_gridtype[:, 0], spc_force_array.data[0])):
          if np.any(spc_force != 0):
            spc_force = np.insert(spc_force, 0, int(node_id))
            temp_list.append(spc_force)
        df_SPC = pd.DataFrame(temp_list, columns=['Node', 'T1', 'T2', 'T3', 'R1', 'R2', 'R3'])
        df_SPC['Node'] = df_SPC['Node'].astype(int)
        df_SPC.iloc[:, 1:] = df_SPC.iloc[:, 1:].round(2)
        self.SPC_results.append(df_SPC)

    ## ELForce 결과 정리하기
    if hasattr(self.op2, 'cbeam_force'):
      self.is_ELForce = True
      self.caseCount = len(self.op2.cbeam_force)
      for subcase, ELforce_array in self.op2.op2_results.force.cbeam_force.items():
        temp_list = []
        for index, (node_id, EL_force) in enumerate(zip(ELforce_array.element_node, ELforce_array.data[0])):
          combined = np.concatenate([node_id, EL_force])
          temp_list.append(combined)
        df_ELforce = pd.DataFrame(temp_list,
                                  columns=['Element', 'Node', 'Length', 'Bending_1', 'Bending_2', 'Shear_1', 'Shear_2',
                                           'Axial', 'Torque', 'W_Torque'])
        df_ELforce.drop(['Length', 'W_Torque'], axis=1, inplace=True)
        df_ELforce['Element'] = df_ELforce['Element'].astype(int)
        df_ELforce['Node'] = df_ELforce['Node'].astype(int)
        df_ELforce.iloc[:, 2:] = df_ELforce.iloc[:, 2:].round(2)
        self.ELForce_results.append(df_ELforce)

    ## Stress1D 결과 정리하기
    if hasattr(self.op2, 'cbeam_stress'):
      self.is_stress1D = True
      self.caseCount = len(self.op2.cbeam_stress)
      for subcase, stress_array in self.op2.cbeam_stress.items():
        temp_list = []
        for index, (node_id, stress1D) in enumerate(zip(stress_array.element_node, stress_array.data[0])):
          combined = np.concatenate([node_id, stress1D])
          temp_list.append(combined)
        df_stress1D = pd.DataFrame(temp_list,
                                   columns=['Element', 'Node', 'SXC', 'SXD', 'SXE', 'SXF', 'S-MAX', 'S-MIN', 'dummy_1',
                                            'dummy_2'])
        df_stress1D.drop(['dummy_1', 'dummy_2'], axis=1, inplace=True)
        df_stress1D['Element'] = df_stress1D['Element'].astype(int)
        df_stress1D['Node'] = df_stress1D['Node'].astype(int)
        df_stress1D.iloc[:, 2:] = df_stress1D.iloc[:, 2:].round(2)
        df_stress1D['Stress'] = np.maximum(np.abs(df_stress1D['S-MAX']), np.abs(df_stress1D['S-MIN']))
        self.stress1D_results.append(df_stress1D)

      ## ROD ELForce 결과 정리하기
    if hasattr(self.op2, 'crod_force'):
      self.is_ELForceROD = True
      self.caseCount = len(self.op2.crod_force)
      crod_force_data = self.op2.crod_force
      for subcase, result in crod_force_data.items():
        # Element ID와 데이터 결합
        combined_data = np.column_stack((result.element, result.data[0]))

        # 데이터 프레임 생성
        df_ELForceROD = pd.DataFrame(combined_data, columns=['Element', 'Axial_Force', 'Torque'])
        df_ELForceROD['Element'] = df_ELForceROD['Element'].astype(int)
        df_ELForceROD[['Axial_Force', 'Torque']] = df_ELForceROD[['Axial_Force', 'Torque']].round(2)

        # 데이터 프레임 출력 (또는 다른 작업 수행)
        self.ELForceROD_results.append(df_ELForceROD)


if __name__ == "__main__":
  #   bdf_file = r'D:\02. Structure department\06. 2024\02. M_Unit\My_Codes\bdf\ex_G_M02_R3_KHM.bdf'
  #   hmnastran = hmNastranBDF_Importer(bdf_file)
  #   hmnastran.run()

  op2_file = r'C:\Coding\Python\Projects\ModuleUnit\bdf\m_unit.op2'
  hmnastran = hmNastranOP2_Analyzer(op2_file)
  hmnastran.resultsSetting()
  # print(hmnastran.disp_results[0][:5])
  # DisplacementDF = hmnastran.disp_results[0][:5]
  # condition = (DisplacementDF['T1'] > 200) | (DisplacementDF['T2'] > 200) | (DisplacementDF['T3'] > 500)
  # test = not condition.any()
  # print(test)

  # print(hmnastran.SPC_results)
  # print(hmnastran.ELForce_results)
  # print(hmnastran.stress1D_results)
