SELECT CASE WHEN 'INVITATION_ARCHIVED' = ANY(enum_range(NULL::"TeamHistoryEvent")::text[]) THEN 0 ELSE 1 END;
