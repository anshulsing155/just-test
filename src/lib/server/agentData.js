import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve('mp_rera_data');
const DELHI_DATA_FILES = [
	path.resolve('delhi_rera_agents_data - Copy.json'),
	path.resolve('delhi_rera_agents_data.json')
];

export async function getMpReraAgents() {
    try {
        const files = await fs.readdir(DATA_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        let allAgents = [];
        for (const file of jsonFiles) {
            const content = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
            const data = JSON.parse(content);
            allAgents = allAgents.concat(data);
        }
        return allAgents;
    } catch (error) {
        console.error('Error reading MP RERA data:', error);
        return [];
    }
}

export async function getDelhiReraAgents() {
	for (const filePath of DELHI_DATA_FILES) {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			return JSON.parse(content);
		} catch {
			// try next candidate
		}
	}

	console.error('Error reading Delhi RERA data: no readable Delhi JSON found');
	return [];
}

// Add more state fetchers as needed
