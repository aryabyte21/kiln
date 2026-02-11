export type HealthResponse = {
  status: 'ok';
  service: 'py-api' | 'go-api' | 'web';
};

export type ServiceStatus = {
  name: string;
  url: string;
  status: 'up' | 'down';
};
