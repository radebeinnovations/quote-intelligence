export interface CatalogRule {
  name: string;
  category: string;
  description: string;
  canonicalUnit: string;
  canonicalBasis: string;
  patterns: RegExp[];
}

const rule = (
  name: string,
  category: string,
  canonicalBasis: string,
  patterns: RegExp[],
  description = `${name}, converged from equivalent supplier descriptions.`
): CatalogRule => ({
  name,
  category,
  description,
  canonicalUnit: canonicalBasis,
  canonicalBasis,
  patterns
});

export const catalogRules: CatalogRule[] = [
  rule("Waitstaff", "Staffing", "person-hour", [/\bwaiter\b/, /\bwaiters\b/, /\bwaitstaff\b/, /\bwaitrons?\b/]),
  rule("Cocktail bartender", "Staffing", "person-hour", [/\bbarman\b/, /\bbar staff\b/, /\bcocktail bartender\b/]),
  rule("Event setup & breakdown crew", "Staffing", "person-hour", [/\bsetup\s*\/\s*breakdown crew\b/, /\bgeneral crew\b/, /\bevent crew\b/]),
  rule("Day security officer", "Staffing", "person-hour", [/\bsecurity guard\s*-\s*day\b/, /\bday security officer\b/, /\bguarding services \(day rate\)/, /\bsecurity\s*-\s*day\b/]),
  rule("Night security officer", "Staffing", "person-hour", [/\bsecurity guard\s*-\s*night\b/, /\bnight security officer\b/, /\bguarding services \(night rate\)/]),
  rule("Event runner", "Staffing", "person-hour", [/\bevent runner\b/, /^runner\b/]),
  rule("Event supervisor", "Staffing", "person-hour", [/\bevent supervisor\b/]),
  rule("Floor manager", "Staffing", "person-hour", [/\bfloor manager\b/]),
  rule("Event manager", "Staffing", "person-hour", [/\bevent manager\b/]),
  rule("Rigging crew", "Production", "person-hour", [/\brigging crew\b/]),
  rule("20 kVA silent generator", "Power", "item-day", [/\b20\s?kva\b.*\bgenerator\b/, /\bgenerator\b.*\b20\s?kva\b/]),
  rule("40 kVA silent generator", "Power", "item-day", [/\b40\s?kva\b.*\bgenerator\b/, /\bgenerator\b.*\b40\s?kva\b/]),
  rule("63A distribution board", "Power", "item-day", [/\bdistribution board\b.*\b63a\b/]),
  rule("Cable crossover ramp, per metre", "Power", "item", [/\bcable crossover ramp\b/]),
  rule("Mobile cold room", "Equipment hire", "item-day", [/\bmobile cold room\b/]),
  rule("3×3 m white gazebo", "Equipment hire", "item-day", [/\bgazebo\b.*\b3\s?x\s?3m\b/, /\b3\s?x\s?3 gazebo\b/]),
  rule("5×5 m white gazebo", "Equipment hire", "item-day", [/\bgazebo\b.*\b5\s?x\s?5m\b/]),
  rule("1.8 m trestle table", "Equipment hire", "item-day", [/\btrestle tables?\b/]),
  rule("White Tiffany chair", "Equipment hire", "item-day", [/\btiffany chairs?\b/]),
  rule("Round white tablecloth", "Equipment hire", "item-day", [/\btable cloth\b.*\bround white\b/, /\bround tablecloth\b.*\bwhite\b/]),
  rule("Hessian table runner", "Decor", "item-day", [/\btable runners?\b.*\bhessian\b/, /\bhessian\b.*\btable runners?\b/]),
  rule("4×4 m wooden dance floor", "Equipment hire", "event", [/\bwooden dance floor\b.*\b4\s?x\s?4m\b/]),
  rule("Standard buffet", "Catering", "person", [/\bstandard buffet\b/]),
  rule("Spitbraai package", "Catering", "person", [/\bspitbraai\b/]),
  rule("Tea and coffee station", "Catering", "person", [/\btea\s*\/\s*coffee station\b/]),
  rule("Canapé platter, 24 pieces", "Catering", "platter", [/\bcanape platter\b.*\b24\b/, /\bcanapé platter\b.*\b24\b/]),
  rule("6×4 m stage", "Production", "event", [/\bstage 6\s?x\s?4m\b/]),
  rule("Small PA system", "Production", "item", [/\bsmall pa system\b/, /\bpa system\s*-\s*small\b/]),
  rule("Basic wash lighting rig", "Production", "item", [/\blighting rig\s*-\s*basic wash\b/, /\bevent lighting\s*-\s*basic\b/]),
  rule("Stage and sound all-in package", "Production", "package", [/\bstage & sound package\b/]),
  rule("Rigging truck return trip", "Transport", "vehicle-trip", [/\btransport\s*-\s*rigging truck\b/]),
  rule("8-ton truck transport, per kilometre", "Transport", "vehicle-km", [/\b8 ton truck\b.*\best\./]),
  rule("1-ton bakkie delivery, per kilometre", "Transport", "vehicle-km", [/\b1 ton bakkie\b/]),
  rule("22-seat shuttle, per kilometre", "Transport", "vehicle-km", [/\b22 seater shuttle bus\b.*\best\./]),
  rule("8-ton truck metro trip", "Transport", "vehicle-trip", [/\btruck hire\s*\(8t\)\s*-\s*metro trip\b/]),
  rule("Local van delivery", "Transport", "vehicle-trip", [/\blocal van delivery\b/]),
  rule("22-seat shuttle trip", "Transport", "vehicle-trip", [/\bshuttle service\s*-\s*22 seater\b/])
];

export function findCatalogRule(description: string): CatalogRule | null {
  const normalized = description
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return catalogRules.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized))) ?? null;
}
