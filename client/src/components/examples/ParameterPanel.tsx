import { ParameterPanel } from "../ParameterPanel";

export default function ParameterPanelExample() {
  return (
    <div className="max-w-md p-6">
      <ParameterPanel onCalculate={(params) => console.log("Params:", params)} />
    </div>
  );
}
