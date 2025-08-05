require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CORESIGNAL_API_KEY;
const API_BASE = 'https://api.coresignal.com/cdapi/v2/job_base';

function sqlEscape(val) {
  if (val == null) return "''";
  return "'" + String(val)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n|\r/g, ' ') + "'";
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/download', async (req, res) => {
  const { limit, startDate, endDate } = req.query;
  if (!limit || !startDate || !endDate) {
    return res.status(400).send('Missing required query parameters: limit, startDate, endDate');
  }

  try {
    const filterBody = {
      created_at_gte: `${startDate} 00:00:00`,
      created_at_lte: `${endDate} 23:59:59`,
      employment_type: 'Internship',
      country: 'United States'
    };
    const searchRes = await axios.post(
      `${API_BASE}/search/filter`,
      filterBody,
      { headers: { 'Content-Type': 'application/json', apikey: API_KEY, Accept: 'application/json' } }
    );

    const raw = searchRes.data;
    const ids = (Array.isArray(raw) ? raw : raw.data || []).slice(0, Number(limit));
    if (ids.length === 0) {
      return res.status(404).send('No US internships found.');
    }

    const jobs = await Promise.all(
      ids.map(id =>
        axios.get(`${API_BASE}/collect/${id}`, { headers: { apikey: API_KEY } })
          .then(r => r.data)
      )
    );

    const table = 'job_postings';
    const columns = [
      'jobid','department','title','location','summary','url',
      'startdate','last_updated','education','requirements','salary',
      'jobtype','jobstatus','source'
    ];

    const values = jobs.map(job => {
      const department = job.company_name || '';
      const title = job.title;
      const location = job.location;
      const summary = job.description;
      const url = job.url;
      const startdate = job.created;
      const last_updated = job.last_updated;
      const education = Array.isArray(job.job_industry_collection)
        ? job.job_industry_collection.map(i => i.job_industry_list.industry).join('|')
        : '';
      const requirements = '';
      const salary = job.salary;
      const jobtype = job.employment_type;
      const jobstatus = job.application_active != null ? job.application_active : '';
      const source = 'coresignal';

      return `(${[
        sqlEscape(job.professional_network_job_id || job.id),
        sqlEscape(department),
        sqlEscape(title),
        sqlEscape(location),
        sqlEscape(summary),
        sqlEscape(url),
        sqlEscape(startdate),
        sqlEscape(last_updated),
        sqlEscape(education),
        sqlEscape(requirements),
        sqlEscape(salary),
        sqlEscape(jobtype),
        sqlEscape(jobstatus),
        sqlEscape(source)
      ].join(',')})`;
    });

    const script = `INSERT INTO \`${table}\` (\`${columns.join('`,`')}\`) VALUES\n${values.join(',\n')};`;

    res.header('Content-Type', 'application/sql');
    res.attachment('insert_job_postings.sql');
    res.send(script);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(`Error: ${err.message}`);
  }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));