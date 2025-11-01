import { CTRCurveChart } from "../CTRCurveChart";

export default function CTRCurveChartExample() {
  const data = Array.from({ length: 20 }, (_, i) => ({
    position: i + 1,
    brandCTR: Math.max(2, 45 - i * 2 - Math.random() * 5),
    nonBrandCTR: Math.max(1, 28 - i * 1.2 - Math.random() * 3),
    combinedCTR: Math.max(1.5, 35 - i * 1.5 - Math.random() * 4),
  }));

  return (
    <div className="p-6">
      <CTRCurveChart data={data} />
    </div>
  );
}
