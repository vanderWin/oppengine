import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { UpliftParameters, DifficultyLevel } from "@shared/schema";

interface ParameterPanelProps {
  availableColumns: string[];
  onParametersChange: (params: UpliftParameters) => void;
}

const DEFAULT_CTR_VALUES = [
  0.2696, 0.2030, 0.1489, 0.1114, 0.0847,
  0.0514, 0.0464, 0.0372, 0.0255, 0.0197,
  0.005, 0.004, 0.003, 0.002, 0.002,
  0.002, 0.001, 0.001, 0.001, 0.001,
];

const DIFFICULTY_LEVELS: DifficultyLevel[] = ["Easy", "Medium", "Hard", "Top10", "N/A"];

export function ParameterPanel({ availableColumns, onParametersChange }: ParameterPanelProps) {
  const [columnMapping, setColumnMapping] = useState({
    keyword: availableColumns[0] || "",
    volume: availableColumns.find(c => c.toUpperCase().includes("VOLUME")) || availableColumns[0] || "",
    difficulty: availableColumns.find(c => c.toUpperCase().includes("DIFFICULTY")) || null,
    startRank: availableColumns.find(c => c.toUpperCase().includes("RANK") && c.includes("[M]")) || null,
    intent: availableColumns.find(c => c.toUpperCase().includes("INTENT")) || null,
    category: availableColumns.find(c => c.toUpperCase().includes("GROUP")) || null,
  });

  const [projectionHorizon, setProjectionHorizon] = useState<{
    monthsAhead: number;
    startDate: string;
    mode: "Average" | "Seasonal";
  }>({
    monthsAhead: 12,
    startDate: getFirstOfNextMonth().toISOString().split("T")[0],
    mode: "Seasonal",
  });

  const [rankCaps, setRankCaps] = useState({
    Easy: null as number | null,
    Medium: 2,
    Hard: 3,
    Top10: null as number | null,
    "N/A": 2,
  });

  const [phaseDurations, setPhaseDurations] = useState({
    T1: 1.0,
    T2: 2.0,
    T3: 3.0,
    T4: 6.0,
    k: 3.5,
  });

  const [difficultyMultipliers, setDifficultyMultipliers] = useState({
    Easy: 0.6,
    Medium: 1.0,
    Hard: 1.6,
    Top10: 2.2,
    "N/A": 1.0,
  });

  const [volumeMultiplier, setVolumeMultiplier] = useState<{
    vMin: number;
    vSpan: number;
    mMin: number;
    mMax: number;
    volMaxMode: "auto" | "manual";
    volMaxManual: number;
  }>({
    vMin: 0.8,
    vSpan: 0.7,
    mMin: 0.8,
    mMax: 1.5,
    volMaxMode: "auto",
    volMaxManual: 100000,
  });

  const [ctrValues] = useState(DEFAULT_CTR_VALUES);

  function getFirstOfNextMonth(): Date {
    const today = new Date();
    if (today.getMonth() === 11) {
      return new Date(today.getFullYear() + 1, 0, 1);
    } else {
      return new Date(today.getFullYear(), today.getMonth() + 1, 1);
    }
  }

  useEffect(() => {
    if (availableColumns.length > 0) {
      setColumnMapping({
        keyword: availableColumns[0],
        volume: availableColumns.find(c => c.toUpperCase().includes("VOLUME")) || availableColumns[0],
        difficulty: availableColumns.find(c => c.toUpperCase().includes("DIFFICULTY")) || null,
        startRank: availableColumns.find(c => c.toUpperCase().includes("RANK") && c.includes("[M]")) || null,
        intent: availableColumns.find(c => c.toUpperCase().includes("INTENT")) || null,
        category: availableColumns.find(c => c.toUpperCase().includes("GROUP")) || null,
      });
    }
  }, [availableColumns]);

  // Auto-notify parent when parameters change
  useEffect(() => {
    const params: UpliftParameters = {
      columnMapping,
      projectionHorizon,
      rankCaps,
      phaseDurations,
      difficultyMultipliers,
      volumeMultiplier,
      ctrValues,
    };
    onParametersChange(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnMapping, projectionHorizon, rankCaps, phaseDurations, difficultyMultipliers, volumeMultiplier, ctrValues]);

  const renderRankCapSelect = (level: DifficultyLevel) => {
    const value = rankCaps[level];
    const options = ["No cap", ...Array.from({ length: 20 }, (_, i) => `Position ${i + 1}`)];

    return (
      <div className="space-y-1" key={level}>
        <Label htmlFor={`rank-cap-${level}`} className="text-sm">{level}</Label>
        <Select
          value={value === null ? "No cap" : `Position ${value}`}
          onValueChange={(val) => {
            const newValue = val === "No cap" ? null : parseInt(val.replace("Position ", ""));
            setRankCaps({ ...rankCaps, [level]: newValue });
          }}
        >
          <SelectTrigger id={`rank-cap-${level}`} data-testid={`select-rank-cap-${level.toLowerCase()}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uplift Parameters</CardTitle>
        <CardDescription>
          Configure analysis settings and projection parameters
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" defaultValue={["projection-horizon"]} className="space-y-2">
          <AccordionItem value="column-mapping">
            <AccordionTrigger className="text-sm font-medium">Column Mapping</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="col-keyword">Keyword column</Label>
                  <Select value={columnMapping.keyword} onValueChange={(val) => setColumnMapping({ ...columnMapping, keyword: val })}>
                    <SelectTrigger id="col-keyword" data-testid="select-column-keyword">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="col-volume">Monthly search volume</Label>
                  <Select value={columnMapping.volume} onValueChange={(val) => setColumnMapping({ ...columnMapping, volume: val })}>
                    <SelectTrigger id="col-volume" data-testid="select-column-volume">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="col-difficulty">Keyword Difficulty</Label>
                  <Select value={columnMapping.difficulty || "<none>"} onValueChange={(val) => setColumnMapping({ ...columnMapping, difficulty: val === "<none>" ? null : val })}>
                    <SelectTrigger id="col-difficulty" data-testid="select-column-difficulty">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<none>">{"<none>"}</SelectItem>
                      {availableColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="col-rank">Starting rank</Label>
                  <Select value={columnMapping.startRank || "<none>"} onValueChange={(val) => setColumnMapping({ ...columnMapping, startRank: val === "<none>" ? null : val })}>
                    <SelectTrigger id="col-rank" data-testid="select-column-startrank">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<none>">{"<none>"}</SelectItem>
                      {availableColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="col-intent">Intent column</Label>
                  <Select value={columnMapping.intent || "<none>"} onValueChange={(val) => setColumnMapping({ ...columnMapping, intent: val === "<none>" ? null : val })}>
                    <SelectTrigger id="col-intent" data-testid="select-column-intent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<none>">{"<none>"}</SelectItem>
                      {availableColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="col-category">Main keyword group</Label>
                  <Select value={columnMapping.category || "<none>"} onValueChange={(val) => setColumnMapping({ ...columnMapping, category: val === "<none>" ? null : val })}>
                    <SelectTrigger id="col-category" data-testid="select-column-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<none>">{"<none>"}</SelectItem>
                      {availableColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="projection-horizon">
            <AccordionTrigger className="text-sm font-medium">Projection Horizon</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="months-ahead">Months ahead</Label>
                  <Input
                    id="months-ahead"
                    type="number"
                    min={1}
                    max={36}
                    value={projectionHorizon.monthsAhead}
                    onChange={(e) => setProjectionHorizon({ ...projectionHorizon, monthsAhead: parseInt(e.target.value) || 12 })}
                    data-testid="input-months-ahead"
                  />
                  <p className="text-xs text-muted-foreground">Projection window length for rank and traffic projection</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="start-date">Projection Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={projectionHorizon.startDate}
                    onChange={(e) => setProjectionHorizon({ ...projectionHorizon, startDate: e.target.value })}
                    data-testid="input-start-date"
                  />
                  <p className="text-xs text-muted-foreground">Month start to anchor projections</p>
                </div>

                <div className="space-y-2">
                  <Label>Projection Mode</Label>
                  <RadioGroup
                    value={projectionHorizon.mode}
                    onValueChange={(val: "Average" | "Seasonal") => setProjectionHorizon({ ...projectionHorizon, mode: val })}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Average" id="mode-average" data-testid="radio-mode-average" />
                      <Label htmlFor="mode-average" className="font-normal cursor-pointer">Average</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Seasonal" id="mode-seasonal" data-testid="radio-mode-seasonal" />
                      <Label htmlFor="mode-seasonal" className="font-normal cursor-pointer">Seasonal</Label>
                    </div>
                  </RadioGroup>
                  <p className="text-xs text-muted-foreground">
                    Average: use uploaded volume for all months. Seasonal: use Google Ads 12-month seasonality per keyword.
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="rank-caps">
            <AccordionTrigger className="text-sm font-medium">Rank Caps by Difficulty</AccordionTrigger>
            <AccordionContent>
              <p className="text-xs text-muted-foreground mb-3">
                Limit how far each difficulty tier can climb. Set to "No cap" to allow improvements to position 1.
              </p>
              <div className="space-y-3">
                {DIFFICULTY_LEVELS.map(level => renderRankCapSelect(level))}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="phase-durations">
            <AccordionTrigger className="text-sm font-medium">Phase Durations</AccordionTrigger>
            <AccordionContent>
              <p className="text-xs text-muted-foreground mb-3">
                Phase durations are base months before difficulty/volume scaling.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="t1">Months to reach 50th (100 → 50)</Label>
                  <Input
                    id="t1"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={phaseDurations.T1}
                    onChange={(e) => setPhaseDurations({ ...phaseDurations, T1: parseFloat(e.target.value) || 1.0 })}
                    data-testid="input-t1"
                  />
                  <p className="text-xs text-muted-foreground">Average time (months) for a keyword to move from rank 100 to 50 before scaling</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="t2">Months to reach page 2 (50 → 20)</Label>
                  <Input
                    id="t2"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={phaseDurations.T2}
                    onChange={(e) => setPhaseDurations({ ...phaseDurations, T2: parseFloat(e.target.value) || 2.0 })}
                    data-testid="input-t2"
                  />
                  <p className="text-xs text-muted-foreground">Months expected to progress from rank 50 to 20</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="t3">Months to reach page 1 (20 → 10)</Label>
                  <Input
                    id="t3"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={phaseDurations.T3}
                    onChange={(e) => setPhaseDurations({ ...phaseDurations, T3: parseFloat(e.target.value) || 3.0 })}
                    data-testid="input-t3"
                  />
                  <p className="text-xs text-muted-foreground">Months to improve from rank 20 to 10</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="t4">Months to reach the top (10 → 1)</Label>
                  <Input
                    id="t4"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={phaseDurations.T4}
                    onChange={(e) => setPhaseDurations({ ...phaseDurations, T4: parseFloat(e.target.value) || 6.0 })}
                    data-testid="input-t4"
                  />
                  <p className="text-xs text-muted-foreground">Months expected to reach position 1 once in the top 10</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="k">Curve steepness (k)</Label>
                  <Input
                    id="k"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={phaseDurations.k}
                    onChange={(e) => setPhaseDurations({ ...phaseDurations, k: parseFloat(e.target.value) || 3.5 })}
                    data-testid="input-k"
                  />
                  <p className="text-xs text-muted-foreground">Controls shape of improvement within each phase. Larger k = faster early gains, slower finish.</p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="difficulty-multipliers">
            <AccordionTrigger className="text-sm font-medium">Difficulty Multipliers</AccordionTrigger>
            <AccordionContent>
              <p className="text-xs text-muted-foreground mb-3">
                Smaller = easier and faster ranking gains; larger = harder and slower progress.
              </p>
              <div className="space-y-3">
                {DIFFICULTY_LEVELS.map((level) => (
                  <div className="space-y-1" key={level}>
                    <Label htmlFor={`diff-mult-${level}`}>{level}</Label>
                    <Input
                      id={`diff-mult-${level}`}
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={difficultyMultipliers[level]}
                      onChange={(e) => setDifficultyMultipliers({ ...difficultyMultipliers, [level]: parseFloat(e.target.value) || 1.0 })}
                      data-testid={`input-difficulty-${level.toLowerCase()}`}
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="volume-multiplier">
            <AccordionTrigger className="text-sm font-medium">Volume Multiplier</AccordionTrigger>
            <AccordionContent>
              <p className="text-xs text-muted-foreground mb-3">
                Adjusts how search volume slows growth. High-volume keywords face tougher competition.
                <br />
                <strong>Formula:</strong> m_v = v_min + v_span × [log10(1 + volume) / log10(1 + vol_max)], clamped to [m_min, m_max]
                <br />
                <em>Smaller m_v → faster progress; larger m_v → slower.</em>
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="v-min">v_min</Label>
                  <Input
                    id="v-min"
                    type="number"
                    step={0.05}
                    value={volumeMultiplier.vMin}
                    onChange={(e) => setVolumeMultiplier({ ...volumeMultiplier, vMin: parseFloat(e.target.value) || 0.8 })}
                    data-testid="input-v-min"
                  />
                  <p className="text-xs text-muted-foreground">Baseline multiplier applied to low-volume keywords (fastest growth)</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="v-span">v_span</Label>
                  <Input
                    id="v-span"
                    type="number"
                    step={0.05}
                    value={volumeMultiplier.vSpan}
                    onChange={(e) => setVolumeMultiplier({ ...volumeMultiplier, vSpan: parseFloat(e.target.value) || 0.7 })}
                    data-testid="input-v-span"
                  />
                  <p className="text-xs text-muted-foreground">Range added to v_min based on keyword volume. Larger = stronger slowdown for high volume.</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="m-min">Clamp m_min</Label>
                  <Input
                    id="m-min"
                    type="number"
                    step={0.05}
                    value={volumeMultiplier.mMin}
                    onChange={(e) => setVolumeMultiplier({ ...volumeMultiplier, mMin: parseFloat(e.target.value) || 0.8 })}
                    data-testid="input-m-min"
                  />
                  <p className="text-xs text-muted-foreground">Lower bound of the final volume multiplier</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="m-max">Clamp m_max</Label>
                  <Input
                    id="m-max"
                    type="number"
                    step={0.05}
                    value={volumeMultiplier.mMax}
                    onChange={(e) => setVolumeMultiplier({ ...volumeMultiplier, mMax: parseFloat(e.target.value) || 1.5 })}
                    data-testid="input-m-max"
                  />
                  <p className="text-xs text-muted-foreground">Upper bound of the final volume multiplier</p>
                </div>

                <div className="space-y-2">
                  <Label>vol_max source</Label>
                  <RadioGroup
                    value={volumeMultiplier.volMaxMode}
                    onValueChange={(val: "auto" | "manual") => setVolumeMultiplier({ ...volumeMultiplier, volMaxMode: val })}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="auto" id="vol-max-auto" data-testid="radio-vol-max-auto" />
                      <Label htmlFor="vol-max-auto" className="font-normal cursor-pointer">Auto from dataset</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="manual" id="vol-max-manual" data-testid="radio-vol-max-manual" />
                      <Label htmlFor="vol-max-manual" className="font-normal cursor-pointer">Manual</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="vol-max-manual-value">vol_max (manual)</Label>
                  <Input
                    id="vol-max-manual-value"
                    type="number"
                    min={1}
                    step={1000}
                    value={volumeMultiplier.volMaxManual}
                    disabled={volumeMultiplier.volMaxMode === "auto"}
                    onChange={(e) => setVolumeMultiplier({ ...volumeMultiplier, volMaxManual: parseInt(e.target.value) || 100000 })}
                    data-testid="input-vol-max-manual"
                  />
                  <p className="text-xs text-muted-foreground">Maximum search volume used to normalize m_v scaling</p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
