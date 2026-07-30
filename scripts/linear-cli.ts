import { config } from "dotenv";
config();

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

if (!LINEAR_API_KEY) {
  console.error("Error: LINEAR_API_KEY is not defined in environment.");
  process.exit(1);
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function linearFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY!
    },
    body: JSON.stringify({ query, variables })
  });

  const json = (await response.json()) as GraphQLResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear API Error: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data!;
}

export async function getLinearContext() {
  const query = `
    query {
      viewer {
        id
        name
        email
      }
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `;
  return linearFetch<{
    viewer: { id: string; name: string; email: string };
    teams: { nodes: Array<{ id: string; name: string; key: string }> };
  }>(query);
}

export async function createLinearIssue(input: {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
}) {
  const query = `
    mutation CreateIssue($teamId: String!, $title: String!, $description: String, $priority: Int) {
      issueCreate(input: { teamId: $teamId, title: $title, description: $description, priority: $priority }) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;
  return linearFetch<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; title: string; url: string };
    };
  }>(query, input);
}

export async function listOpenIssues(teamId?: string) {
  const query = `
    query ListIssues($teamId: String) {
      issues(filter: { state: { type: { neq: "completed" } } }, first: 20) {
        nodes {
          id
          identifier
          title
          description
          priority
          state {
            name
            type
          }
          team {
            id
            key
          }
        }
      }
    }
  `;
  return linearFetch<{
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description: string;
        priority: number;
        state: { name: string; type: string };
        team: { id: string; key: string };
      }>;
    };
  }>(query, { teamId });
export async function getTeamWorkflowStates(teamId: string) {
  const query = `
    query GetWorkflowStates($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  `;
  return linearFetch<{
    team: {
      states: {
        nodes: Array<{ id: string; name: string; type: string }>;
      };
    };
  }>(query, { teamId });
}

export async function markIssueCompleted(issueId: string, completedStateId: string) {
  const query = `
    mutation UpdateIssue($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
        issue {
          id
          identifier
          title
          state {
            name
            type
          }
        }
      }
    }
  `;
  return linearFetch<{
    issueUpdate: {
      success: boolean;
      issue: { id: string; identifier: string; title: string; state: { name: string; type: string } };
    };
  }>(query, { issueId, stateId: completedStateId });
}

// CLI handler if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("linear-cli.ts")) {
  const action = process.argv[2] ?? "info";

  (async () => {
    try {
      if (action === "info" || action === "list-teams") {
        const info = await getLinearContext();
        console.log(`Connected to Linear as: ${info.viewer.name} (${info.viewer.email})`);
        console.log(`Teams available:`);
        info.teams.nodes.forEach((t) => console.log(`  - [${t.key}] ${t.name} (ID: ${t.id})`));
      } else if (action === "issues") {
        const data = await listOpenIssues();
        console.log(`Open Linear Issues:`);
        data.issues.nodes.forEach((i) =>
          console.log(`  - [${i.identifier}] ${i.title} (${i.state.name})`)
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  })();
}
