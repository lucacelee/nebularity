import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const blog = defineCollection({
    schema: z.object({
        title: z.string(),
        pubDate: z.date(),
        author: z.string(),
        // tags: z.array(z.string()).default([]),
    }),
});