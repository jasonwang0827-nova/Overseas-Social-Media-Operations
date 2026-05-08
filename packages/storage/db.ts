export interface DatabaseAdapter {
  name: string;
}

export const jsonDatabaseAdapter: DatabaseAdapter = {
  name: "json"
};
