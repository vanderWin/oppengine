import { FileUploadZone } from "../FileUploadZone";

export default function FileUploadZoneExample() {
  return (
    <div className="max-w-2xl p-6">
      <FileUploadZone
        onFileSelect={(file) => console.log("File selected:", file.name)}
        formats={["CSV", "XLSX"]}
      />
    </div>
  );
}
