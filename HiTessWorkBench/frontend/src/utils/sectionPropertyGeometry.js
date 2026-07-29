export function createTeePolygon(params) {
  const { h, bf, tf, tw } = params;
  const hw = h - tf;
  const flangeArea = bf * tf;
  const stemArea = tw * hw;
  const area = flangeArea + stemArea;
  const centroidY = (
    flangeArea * (h - tf / 2)
    + stemArea * (hw / 2)
  ) / area;
  const shiftY = -centroidY;

  const engineOrientedPolygon = [
    { x: -tw / 2, y: shiftY },
    { x: tw / 2, y: shiftY },
    { x: tw / 2, y: hw + shiftY },
    { x: bf / 2, y: hw + shiftY },
    { x: bf / 2, y: h + shiftY },
    { x: -bf / 2, y: h + shiftY },
    { x: -bf / 2, y: hw + shiftY },
    { x: -tw / 2, y: hw + shiftY },
  ];

  // WorkBench에서는 유효폭 선체판이 +Y 방향의 부재 끝에 부착된다.
  // Tee의 스템 끝이 선체판에 닿고 플랜지가 반대편에 오도록 X축 대칭한다.
  return engineOrientedPolygon.map(point => ({ x: point.x, y: -point.y }));
}

const reflectPointAboutXAxis = point => (
  point ? { ...point, y: -point.y } : point
);

export function orientSectionResultForApp(shapeKey, result) {
  if (shapeKey !== 'tee' || !result) return result;

  return {
    ...result,
    centroid: reflectPointAboutXAxis(result.centroid),
    Ixy: result.Ixy == null ? result.Ixy : -result.Ixy,
    Sx_top: result.Sx_bot,
    Sx_bot: result.Sx_top,
    principal: result.principal
      ? {
          ...result.principal,
          angle: result.principal.angle == null
            ? result.principal.angle
            : -result.principal.angle,
        }
      : result.principal,
    shearCenter: reflectPointAboutXAxis(result.shearCenter),
    bbox: result.bbox
      ? {
          ...result.bbox,
          ymin: -result.bbox.ymax,
          ymax: -result.bbox.ymin,
        }
      : result.bbox,
    polygon: result.polygon?.map(reflectPointAboutXAxis) ?? result.polygon,
  };
}
