const LINEAR_API_KEY = "lin_api_HigEO7Gm19Ua26SkmkSD1HZBPwVHxqVU9UQkqxIu";
const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

async function linearFetch(query, variables) {
  const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await response.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear API Error: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data;
}

async function runGoalCompletion() {
  console.log("Connecting to Linear for goal completion...");
  const context = await linearFetch(`
    query {
      viewer { id name email }
      teams { nodes { id name key states { nodes { id name type } } } }
    }
  `);

  const team = context.teams.nodes[0];
  if (!team) throw new Error("No Linear team found!");
  const doneState = team.states.nodes.find((s) => s.type === "completed") || team.states.nodes[0];

  const tickets = [
    {
      title: "CSV Procurement Benchmark & Line Item Exports",
      description: "Implement CSV export buttons for catalog services, fair-price metrics, and linked supplier line items."
    },
    {
      title: "Supplier Procurement Performance & Price Variance Page",
      description: "Add a /suppliers view showing supplier rate variances relative to canonical fair market benchmarks."
    },
    {
      title: "Ingestion Audit & Extraction Warning Queue View",
      description: "Add an /ingestion-audit page showing ingestion runs, extracted line counts, and parsing warnings."
    }
  ];

  for (const t of tickets) {
    const res = await linearFetch(
      `
      mutation CreateIssue($teamId: String!, $title: String!, $description: String, $stateId: String) {
        issueCreate(input: { teamId: $teamId, title: $title, description: $description, stateId: $stateId }) {
          success
          issue { id identifier title state { name } }
        }
      }
      `,
      { teamId: team.id, title: t.title, description: t.description, stateId: doneState.id }
    );
    console.log(`Created & Completed Ticket [${res.issueCreate.issue.identifier}]: ${res.issueCreate.issue.title} (${res.issueCreate.issue.state.name})`);
  }
}

runGoalCompletion().catch((err) => console.error("Completion error:", err));
