import { DataTable } from "../DataTable";
import { Badge } from "@/components/ui/badge";

export default function DataTableExample() {
  const data = [
    { keyword: "seo marketing", position: 5, clicks: 1234, impressions: 45678, ctr: 2.7 },
    { keyword: "content strategy", position: 3, clicks: 2341, impressions: 32145, ctr: 7.3 },
    { keyword: "digital advertising", position: 12, clicks: 456, impressions: 18234, ctr: 2.5 },
    { keyword: "analytics tools", position: 8, clicks: 891, impressions: 23456, ctr: 3.8 },
  ];

  const columns = [
    { key: "keyword", header: "Keyword", sortable: true },
    {
      key: "position",
      header: "Position",
      sortable: true,
      render: (value: number) => (
        <Badge variant={value <= 3 ? "default" : "secondary"}>
          {value}
        </Badge>
      ),
    },
    { key: "clicks", header: "Clicks", sortable: true },
    { key: "impressions", header: "Impressions", sortable: true },
    {
      key: "ctr",
      header: "CTR %",
      sortable: true,
      render: (value: number) => `${value.toFixed(1)}%`,
    },
  ];

  return (
    <div className="p-6">
      <DataTable
        data={data}
        columns={columns}
        onRowClick={(row) => console.log("Clicked row:", row)}
      />
    </div>
  );
}
