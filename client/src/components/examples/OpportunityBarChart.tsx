import { OpportunityBarChart } from "../OpportunityBarChart";

export default function OpportunityBarChartExample() {
  const data = [
    { category: "SEO Marketing", opportunityScore: 92, estimatedSessions: 12500 },
    { category: "Content Strategy", opportunityScore: 85, estimatedSessions: 9800 },
    { category: "Analytics Tools", opportunityScore: 78, estimatedSessions: 7200 },
    { category: "Digital Advertising", opportunityScore: 65, estimatedSessions: 5400 },
    { category: "Social Media", opportunityScore: 52, estimatedSessions: 3900 },
  ];

  return (
    <div className="p-6">
      <OpportunityBarChart
        data={data}
        onCategoryClick={(cat) => console.log("Category clicked:", cat)}
      />
    </div>
  );
}
