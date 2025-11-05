import { OpportunityBarChart } from "../OpportunityBarChart";

export default function OpportunityBarChartExample() {
  const data = [
    { category: "SEO Marketing", opportunityScore: 9.2, estimatedSessions: 12500 },
    { category: "Content Strategy", opportunityScore: 8.5, estimatedSessions: 9800 },
    { category: "Analytics Tools", opportunityScore: 7.8, estimatedSessions: 7200 },
    { category: "Digital Advertising", opportunityScore: 6.5, estimatedSessions: 5400 },
    { category: "Social Media", opportunityScore: 5.2, estimatedSessions: 3900 },
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
