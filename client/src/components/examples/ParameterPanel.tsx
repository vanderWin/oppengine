import { ParameterPanel } from "../ParameterPanel";

export default function ParameterPanelExample() {
  const exampleColumns = ["Keyword", "Volume", "Difficulty", "Start Rank [M]", "Intent", "Group"];

  return (
    <div className="max-w-md p-6">
      <ParameterPanel
        availableColumns={exampleColumns}
        onParametersChange={(params) => console.log("Params:", params)}
      />
    </div>
  );
}
