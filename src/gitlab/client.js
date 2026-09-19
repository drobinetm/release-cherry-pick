'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { GitLabError } = require('../utils/errors');

class GitLabClient {
  constructor(url, token, projectId) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.projectId = projectId;
    this.client = axios.create({
      baseURL: `${this.url}/api/v4`,
      headers: {
        'PRIVATE-TOKEN': token
      }
    });
  }

  async validateConnection() {
    try {
      const response = await this.client.get('/user');
      logger.info(`Authenticated as: ${response.data.username}`);
      return true;
    } catch (error) {
      throw new GitLabError(`Failed to authenticate: ${error.message}`);
    }
  }

  async createMergeRequest(sourceBranch, targetBranch, title, description = '') {
    try {
      const response = await this.client.post(`/projects/${this.projectId}/merge_requests`, {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        description
      });

      logger.success(`MR created: ${response.data.web_url}`);
      return {
        id: response.data.iid,
        url: response.data.web_url,
        title: response.data.title
      };
    } catch (error) {
      throw new GitLabError(`Failed to create MR: ${error.message}`);
    }
  }

  async getCommits(branchName) {
    try {
      const response = await this.client.get(`/projects/${this.projectId}/repository/commits`, {
        params: {
          ref_name: branchName,
          per_page: 100
        }
      });

      return response.data.map(commit => ({
        hash: commit.short_id,
        message: commit.message,
        author: commit.author_name,
        date: commit.committed_date
      }));
    } catch (error) {
      throw new GitLabError(`Failed to get commits: ${error.message}`);
    }
  }
}

module.exports = GitLabClient;
