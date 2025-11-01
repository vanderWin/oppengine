import { UpliftForecastChart } from "../UpliftForecastChart";

export default function UpliftForecastChartExample() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  const data = months.map((month, i) => {
    const isHistoric = i < 4;
    return {
      date: month,
      historic: isHistoric ? 45000 + i * 2000 + Math.random() * 3000 : undefined,
      predictedBrand: !isHistoric ? 28000 + i * 1500 : 0,
      predictedNonBrand: !isHistoric ? 32000 + i * 1800 : 0,
      uplift: !isHistoric ? 8000 + i * 500 : 0,
    };
  });

  return (
    <div className="p-6">
      <UpliftForecastChart
        data={data}
        onExport={() => console.log("Export chart")}
      />
    </div>
  );
}
